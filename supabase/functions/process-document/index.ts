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
    // Use PDF.js compatible with Deno
    const pdfjs = await import("https://esm.sh/pdfjs-dist@4.10.38");
    
    // Configure worker-less mode for Deno
    pdfjs.GlobalWorkerOptions.workerSrc = '';
    
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((item: any) => item.str).filter(Boolean);
      fullText += strings.join(' ') + '\n\n';
    }
    
    return fullText.trim();
  } catch (error) {
    console.error('PDF extraction failed:', error);
    throw new Error(`PDF extraction failed: ${error.message}`);
  }
}

async function extractTextFromDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    // Use unzipper and XML parsing for DOCX
    const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
    const zip = await JSZip.loadAsync(arrayBuffer);
    
    // Extract document.xml which contains the main text content
    const documentXml = await zip.file("word/document.xml")?.async("text");
    if (!documentXml) {
      throw new Error("Could not find document.xml in DOCX file");
    }
    
    // Simple XML text extraction (remove tags, decode entities)
    const textContent = documentXml
      .replace(/<[^>]*>/g, ' ') // Remove XML tags
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
    
    return textContent;
  } catch (error) {
    console.error('DOCX extraction failed:', error);
    throw new Error(`DOCX extraction failed: ${error.message}`);
  }
}

async function generateWithAI(prompt: string) {
  // Try OpenAI first, then fallback to Gemini
  const openAIKey = Deno.env.get("OPENAI_API_KEY");
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  
  if (!openAIKey && !geminiKey) {
    throw new Error("Either OPENAI_API_KEY or GEMINI_API_KEY must be set in Supabase secrets");
  }

  const systemInstructions = `You are an accessibility remediation engine.
Transform the provided document content into a clean, semantically structured, WCAG 2.2 AA compliant HTML fragment.

CRITICAL REQUIREMENTS:
- Return JSON ONLY with keys: accessible_html (string), summary (string). No extra text, no code fences.
- accessible_html MUST be a complete HTML fragment wrapped in a single <article>.
- Preserve the user's ACTUAL content VERBATIM. Do not invent or hallucinate content. Use the exact text provided.
- Maintain logical reading order and heading hierarchy starting with <h1>.
- Use semantic HTML: <header>, <section>, <aside>, lists, <figure><img alt="..."><figcaption>, and accessible <table> with <caption>, <thead>, <tbody>, <th scope>.
- Add proper alt text to images, captions to tables, and labels to forms.
- If the input includes structured data, preserve that structure with proper HTML semantics.
- Only use placeholder text in square brackets when the original truly lacks specific information.

Include a 1-2 sentence summary of the main accessibility fixes applied.`;

  if (openAIKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAIKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemInstructions },
            { role: 'user', content: `Document content to remediate:\n${prompt}` }
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.choices[0].message.content;
        const parsed = JSON.parse(content);
        if (parsed && parsed.accessible_html && parsed.summary) {
          return parsed;
        }
      }
    } catch (error) {
      console.error('OpenAI failed, trying Gemini:', error);
    }
  }

  // Fallback to Gemini
  if (geminiKey) {
    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { text: `${systemInstructions}\n\nDocument content to remediate:\n${prompt}` },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    };

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
      try {
        const parsed = JSON.parse(text);
        if (parsed && parsed.accessible_html && parsed.summary) return parsed;
      } catch (e) {
        console.error('Failed to parse Gemini response:', e);
      }
    }
  }

  // Last resort fallback
  return {
    accessible_html: `<article><h1>Document Processing Error</h1><p>Could not process the uploaded document. Please try again.</p></article>`,
    summary: "Document processing failed - manual review required.",
  };
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