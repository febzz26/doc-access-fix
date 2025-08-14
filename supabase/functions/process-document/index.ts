import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProcessRequestBody {
  file_urls: string[];
  raw_text?: string;
}

function getSupabaseClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/ANON_KEY in secrets");
  }
  return createClient(supabaseUrl, serviceKey);
}

async function extractTextFromPdf(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    console.log('Starting PDF text extraction...');
    
    // Convert to base64 for Gemini vision processing
    const uint8Array = new Uint8Array(arrayBuffer);
    const base64 = btoa(String.fromCharCode(...uint8Array));
    
    console.log(`PDF file size: ${arrayBuffer.byteLength} bytes`);
    
    // Use Gemini Vision to extract text from PDF
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      throw new Error("GEMINI_API_KEY not found");
    }

    const body = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Extract all text content from this PDF document. Return only the plain text content, preserving the structure but removing any formatting. Do not add any commentary or explanations - just return the extracted text exactly as it appears in the document."
            },
            {
              inline_data: {
                mime_type: "application/pdf",
                data: base64
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096
      }
    };

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + geminiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    if (response.ok) {
      const data = await response.json();
      const extractedText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      
      console.log(`Gemini extracted ${extractedText.length} characters from PDF`);
      
      if (extractedText.length > 20) {
        return extractedText.trim();
      }
    } else {
      const errorText = await response.text();
      console.error('Gemini Vision API error:', errorText);
    }
    
    // If Gemini Vision fails, fall back to simple text extraction
    console.log('Falling back to basic PDF text extraction...');
    return await fallbackPdfExtraction(uint8Array);
    
  } catch (error) {
    console.error('PDF extraction error:', error);
    return await fallbackPdfExtraction(new Uint8Array(arrayBuffer));
  }
}

async function fallbackPdfExtraction(uint8Array: Uint8Array): Promise<string> {
  try {
    // Simple text extraction for basic PDFs
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const content = decoder.decode(uint8Array);
    
    let extractedText = '';
    
    // Extract text from PDF text objects
    const textRegex = /BT\s+.*?ET/gs;
    const textBlocks = content.match(textRegex) || [];
    
    for (const block of textBlocks) {
      // Extract strings within parentheses
      const stringMatches = block.match(/\(([^)]*)\)/g) || [];
      for (const match of stringMatches) {
        const text = match.slice(1, -1)
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\(.)/g, '$1');
        
        if (text.length > 1 && /[a-zA-Z0-9]/.test(text)) {
          extractedText += text + ' ';
        }
      }
    }
    
    // Clean up
    extractedText = extractedText
      .replace(/\s+/g, ' ')
      .trim();
    
    console.log(`Fallback extraction found ${extractedText.length} characters`);
    
    if (extractedText.length > 20) {
      return extractedText;
    }
    
    // Last resort: return file info
    return `This appears to be a PDF document that requires manual processing. File size: ${Math.round(uint8Array.length / 1024)}KB. Please ensure the PDF contains readable text and try again.`;
    
  } catch (error) {
    console.error('Fallback extraction failed:', error);
    return `PDF processing failed. File size: ${Math.round(uint8Array.length / 1024)}KB. This document may be encrypted, image-based, or corrupted.`;
  }
}

async function extractTextFromDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
    const zip = await JSZip.loadAsync(arrayBuffer);
    
    const documentXml = await zip.file("word/document.xml")?.async("text");
    if (!documentXml) {
      throw new Error("Could not find document.xml in DOCX file");
    }
    
    const textContent = documentXml
      .replace(/<[^>]*>/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    
    return textContent;
  } catch (error) {
    console.error('DOCX extraction failed:', error);
    return '';
  }
}

async function generateWithGemini(prompt: string, fileName?: string) {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) {
    throw new Error("GEMINI_API_KEY is not set in Supabase secrets");
  }

  console.log('Using Gemini API for processing');

  const systemInstructions = `You are an expert accessibility remediation specialist. Your job is to convert document content into clean, accessible HTML format.

CRITICAL REQUIREMENTS:
1. Return ONLY JSON with keys: "accessible_html" (string), "summary" (string). No code fences, no extra text.
2. The accessible_html must be a complete HTML fragment wrapped in <article> tags.
3. PRESERVE ALL ACTUAL TEXT CONTENT exactly as provided. Do not create generic placeholder content.
4. Use proper semantic HTML: <h1>, <h2>, <section>, <p>, <ul>, <ol>, <table>, etc.
5. Ensure WCAG 2.2 AA compliance with proper headings hierarchy.
6. Add meaningful alt text for images, proper table captions, and semantic structure.
7. If given extracted text content, use it exactly as the source material.
8. Create a meaningful summary that reflects the actual document content.

ABSOLUTELY FORBIDDEN:
- DO NOT create generic content like "How to Ace That Interview" if that's not what the document is about
- DO NOT make up titles, headings, or content that doesn't exist in the source
- DO NOT use placeholder text or examples
- ONLY use the actual text content provided to you

IMPORTANT: The content you receive IS the real document content. Process it exactly as written, preserving all actual text, headings, and structure from the source document.`;

  const userPrompt = fileName 
    ? `Process the content from this document file "${fileName}":\n\n${prompt}`
    : `Process this document content:\n\n${prompt}`;

  const body = {
    contents: [
      {
        role: "user", 
        parts: [
          { text: `${systemInstructions}\n\n${userPrompt}` },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      topP: 0.8,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
    },
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + geminiKey,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (resp.ok) {
        const data = await resp.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        console.log('Gemini raw response:', text.substring(0, 200));
        
        try {
          const parsed = JSON.parse(text);
          if (parsed && parsed.accessible_html && parsed.summary) {
            console.log('Successfully parsed Gemini response');
            return parsed;
          }
          throw new Error("Gemini returned unexpected JSON shape");
        } catch (e) {
          console.error('Failed to parse Gemini response:', e);
          return {
            accessible_html: `<article><h1>Processing Error</h1><p>${text || "Could not process document"}</p></article>`,
            summary: "Document processing encountered an error.",
          };
        }
      }

      const errorText = await resp.text().catch(() => '');
      console.error(`Gemini API error (attempt ${attempt + 1}):`, errorText);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    } catch (error) {
      console.error(`Gemini API error (attempt ${attempt + 1}):`, error);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }

  throw new Error("Gemini API failed after 3 attempts");
}

async function fetchAndExtractText(url: string): Promise<{ text: string; contentType: string; fileName: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch file: ${response.status}`);
  
  const contentType = response.headers.get("content-type") || "";
  const arrayBuffer = await response.arrayBuffer();
  const fileName = url.split("/").pop() || "document";

  console.log(`Processing file "${fileName}" with content-type: ${contentType}`);

  // Handle text files directly
  if (contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("xml") || contentType.includes("html")) {
    const text = new TextDecoder().decode(arrayBuffer);
    return { text, contentType, fileName };
  }

  // Handle PDF files
  if (contentType === "application/pdf" || url.toLowerCase().endsWith('.pdf')) {
    try {
      const text = await extractTextFromPdf(arrayBuffer);
      if (text.length > 0) {
        console.log(`Successfully extracted ${text.length} characters from PDF`);
        return { text, contentType, fileName };
      }
    } catch (error) {
      console.error('PDF extraction failed:', error);
    }
  }

  // Handle DOCX files
  if (contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || url.toLowerCase().endsWith('.docx')) {
    try {
      const text = await extractTextFromDocx(arrayBuffer);
      if (text.length > 0) {
        return { text, contentType, fileName };
      }
    } catch (error) {
      console.error('DOCX extraction failed:', error);
    }
  }

  // For files where extraction failed, provide file info for AI processing
  const fileSize = arrayBuffer.byteLength;
  const text = `File: ${fileName}
Content Type: ${contentType}
File Size: ${Math.round(fileSize / 1024)}KB

Note: This appears to be a ${contentType} file. Please process this document and create accessible content based on the file type and context.`;

  return { text, contentType, fileName };
}

async function uploadProcessedHtml(html: string) {
  const supabase = getSupabaseClient();
  const fileName = `processed/${Date.now()}-${Math.random().toString(36).slice(2)}.html`;
  const { error } = await supabase.storage
    .from("uploads")
    .upload(fileName, new Blob([html], { type: "text/html" }), {
      contentType: "text/html",
      upsert: true,
    });
  if (error) throw error;

  const { data } = supabase.storage.from("uploads").getPublicUrl(fileName);
  return data.publicUrl;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as ProcessRequestBody & { extracted_text?: string };
    const urls = Array.isArray(body?.file_urls) ? body.file_urls : [];
    const providedText = (body as any).raw_text || (body as any).extracted_text || '';

    console.log('Processing request:', { urlCount: urls.length, hasProvidedText: !!providedText });

    if (!urls.length && !providedText) {
      return new Response(JSON.stringify({ error: "file_urls or raw_text is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sourceText = providedText;
    let fileName = '';
    
    // If no text provided or it's a backend processing marker, extract from uploaded file
    if (!sourceText || sourceText.startsWith('BACKEND_PROCESSING_REQUIRED:')) {
      if (urls.length === 0) {
        throw new Error("No file URLs provided for backend processing");
      }
      
      const { text, fileName: extractedFileName } = await fetchAndExtractText(urls[0]);
      sourceText = text;
      fileName = extractedFileName;
      console.log(`Extracted ${text.length} characters from file: ${fileName}`);
    }

    if (!sourceText || sourceText.trim().length === 0) {
      throw new Error("No content could be extracted from the document");
    }

    const { accessible_html, summary } = await generateWithGemini(sourceText, fileName);
    const processed_document_url = await uploadProcessedHtml(accessible_html);

    return new Response(
      JSON.stringify({
        accessible_content: accessible_html,
        summary,
        processed_document_url,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("process-document error:", err);
    return new Response(
      JSON.stringify({ error: String((err as Error).message || err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});