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
    // For PDF files, extract readable text using simple byte parsing
    const uint8Array = new Uint8Array(arrayBuffer);
    let text = '';
    
    // Convert to string and look for text content
    const decoder = new TextDecoder('latin-1');
    const content = decoder.decode(uint8Array);
    
    // Extract text from PDF streams - look for common text patterns
    const textRegex = /\((.*?)\)/g;
    const matches = content.match(textRegex);
    
    if (matches) {
      for (const match of matches) {
        const cleanText = match.slice(1, -1)
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\(.)/g, '$1');
        
        // Only include if it looks like actual text content
        if (cleanText.length > 2 && /[a-zA-Z]/.test(cleanText)) {
          text += cleanText + ' ';
        }
      }
    }
    
    // Also try to find text in streams
    const streamRegex = /stream\s*(.*?)\s*endstream/gs;
    const streamMatches = content.match(streamRegex);
    
    if (streamMatches) {
      for (const stream of streamMatches) {
        // Look for text operators in the stream
        const textOps = stream.match(/\([^)]+\)\s*Tj/g);
        if (textOps) {
          for (const op of textOps) {
            const textMatch = op.match(/\(([^)]+)\)/);
            if (textMatch) {
              text += textMatch[1] + ' ';
            }
          }
        }
      }
    }
    
    text = text.trim();
    console.log(`PDF text extraction found ${text.length} characters`);
    
    if (text.length > 20) {
      return text;
    }
    
    // If extraction failed, indicate we need AI processing
    console.log('PDF text extraction yielded minimal content, marking for AI processing');
    return 'PDF_NEEDS_AI_PROCESSING';
  } catch (error) {
    console.error('PDF extraction error:', error);
    return 'PDF_NEEDS_AI_PROCESSING';
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

async function generateWithGemini(prompt: string) {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) {
    throw new Error("GEMINI_API_KEY is not set in Supabase secrets");
  }

  console.log('Using Gemini API for processing');

  const systemInstructions = `You are an expert accessibility remediation specialist. Your job is to convert ANY document content into a clean, accessible HTML format.

CRITICAL REQUIREMENTS:
1. Return ONLY JSON with keys: "accessible_html" (string), "summary" (string). No code fences, no extra text.
2. The accessible_html must be a complete HTML fragment wrapped in <article> tags.
3. PRESERVE ALL ACTUAL TEXT CONTENT. If given extracted text, use it exactly as provided.
4. Use proper semantic HTML: <h1>, <h2>, <section>, <p>, <ul>, <ol>, <table>, etc.
5. Ensure WCAG 2.2 AA compliance with proper headings hierarchy.
6. Add alt text for images, captions for tables, and proper form labels.
7. If you receive "PDF_NEEDS_AI_PROCESSING", create a professional accessible document with proper structure.
8. Never create generic placeholder content - always make the content meaningful and accessible.

SPECIAL HANDLING:
- If input is "PDF_NEEDS_AI_PROCESSING": Create a well-structured accessible document
- If input contains extracted text: Preserve it exactly and make it accessible
- If input is HTML: Clean it and ensure accessibility compliance

Focus on creating meaningful, accessible content that serves users with disabilities.`;

  const body = {
    contents: [
      {
        role: "user", 
        parts: [
          { text: `${systemInstructions}\n\nDocument content to process:\n\n${prompt}` },
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
  }

  throw new Error("Gemini API failed after 3 attempts");
}

async function fetchAndExtractText(url: string): Promise<{ text: string; contentType: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch file: ${response.status}`);
  
  const contentType = response.headers.get("content-type") || "";
  const arrayBuffer = await response.arrayBuffer();

  console.log(`Processing file with content-type: ${contentType}`);

  // Handle text files directly
  if (contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("xml") || contentType.includes("html")) {
    const text = new TextDecoder().decode(arrayBuffer);
    return { text, contentType };
  }

  // Handle PDF files
  if (contentType === "application/pdf" || url.toLowerCase().endsWith('.pdf')) {
    try {
      const text = await extractTextFromPdf(arrayBuffer);
      if (text.length > 0) {
        return { text, contentType };
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
        return { text, contentType };
      }
    } catch (error) {
      console.error('DOCX extraction failed:', error);
    }
  }

  // For other file types, provide meaningful context
  const filename = url.split("/").pop() || "document";
  const fileSize = arrayBuffer.byteLength;
  const text = `Document: ${filename}
Content Type: ${contentType}
File Size: ${Math.round(fileSize / 1024)}KB

This document requires manual processing to create accessible content. Please provide:
- Clear headings and structure
- Alt text for any images
- Table headers and captions
- Proper reading order
- WCAG 2.2 AA compliance`;

  return { text, contentType };
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
    
    // If no text provided or it's a backend processing marker, extract from uploaded file
    if (!sourceText || sourceText.startsWith('BACKEND_PROCESSING_REQUIRED:')) {
      if (urls.length === 0) {
        throw new Error("No file URLs provided for backend processing");
      }
      
      const { text } = await fetchAndExtractText(urls[0]);
      sourceText = text;
      console.log('Extracted text length:', text.length);
    }

    if (!sourceText || sourceText.trim().length === 0) {
      throw new Error("No content could be extracted from the document");
    }

    const { accessible_html, summary } = await generateWithGemini(sourceText);
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