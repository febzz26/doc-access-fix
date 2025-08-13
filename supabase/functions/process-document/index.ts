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

async function extractTextFromPdf(arrayBuffer: ArrayBuffer, url: string): Promise<string> {
  try {
    console.log('Processing PDF with OpenAI vision...');
    
    // For PDFs, we'll use OpenAI's vision model to read the content
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      console.log('No OpenAI key, falling back to Gemini for direct processing');
      return 'PDF_DIRECT_PROCESSING_NEEDED';
    }

    // Convert first few pages of PDF to images and process with vision
    // For now, let's use a direct approach with the PDF URL
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1-2025-04-14',
        messages: [
          {
            role: 'system',
            content: 'You are a PDF text extraction specialist. Extract ALL text content from the document exactly as it appears. Return only the extracted text, preserving formatting, headings, and structure.'
          },
          {
            role: 'user',
            content: `Please extract all text content from this PDF document. The PDF is available at: ${url}\n\nReturn the complete text content exactly as it appears in the document.`
          }
        ],
        max_tokens: 4000,
        temperature: 0.1
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const extractedText = data.choices[0]?.message?.content || '';
      console.log(`OpenAI extracted ${extractedText.length} characters from PDF`);
      
      if (extractedText.length > 50) {
        return extractedText;
      }
    }
    
    console.log('OpenAI extraction failed, marking for direct processing');
    return 'PDF_DIRECT_PROCESSING_NEEDED';
  } catch (error) {
    console.error('OpenAI PDF extraction error:', error);
    return 'PDF_DIRECT_PROCESSING_NEEDED';
  }
}

async function generateWithAI(prompt: string) {
  // Try OpenAI first, then fall back to Gemini
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  
  if (openaiKey && prompt !== 'PDF_DIRECT_PROCESSING_NEEDED') {
    return await generateWithOpenAI(prompt);
  } else if (geminiKey) {
    return await generateWithGemini(prompt);
  } else {
    throw new Error("No AI API keys available");
  }
}

async function generateWithOpenAI(prompt: string) {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    throw new Error("OPENAI_API_KEY is not set in Supabase secrets");
  }

  console.log('Using OpenAI for processing');

  const systemPrompt = `You are an expert accessibility remediation specialist. Convert document content into clean, accessible HTML.

CRITICAL REQUIREMENTS:
1. Return ONLY JSON with keys: "accessible_html" (string), "summary" (string). No code fences, no extra text.
2. The accessible_html must be a complete HTML fragment wrapped in <article> tags.
3. PRESERVE ALL ACTUAL TEXT CONTENT exactly as provided.
4. Use proper semantic HTML: <h1>, <h2>, <section>, <p>, <ul>, <ol>, <table>, etc.
5. Ensure WCAG 2.2 AA compliance with proper headings hierarchy.
6. Create meaningful, accessible content that serves users with disabilities.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4.1-2025-04-14',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Process this document content:\n\n${prompt}` }
      ],
      max_tokens: 4000,
      temperature: 0.1,
      response_format: { type: "json_object" }
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('OpenAI API error:', errorText);
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content || "";
  
  try {
    const parsed = JSON.parse(content);
    console.log('Successfully parsed OpenAI response');
    return parsed;
  } catch (e) {
    console.error('Failed to parse OpenAI response:', e);
    return {
      accessible_html: `<article><h1>Processing Error</h1><p>${content || "Could not process document"}</p></article>`,
      summary: "Document processing encountered an error.",
    };
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
      const text = await extractTextFromPdf(arrayBuffer, url);
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

    const { accessible_html, summary } = await generateWithAI(sourceText);
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