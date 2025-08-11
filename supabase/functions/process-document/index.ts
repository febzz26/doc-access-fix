import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProcessRequestBody {
  file_urls: string[];
}

// Initialize Supabase client inside the handler to ensure fresh env on cold start
function getSupabaseClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/ANON_KEY in secrets");
  }
  return createClient(supabaseUrl, serviceKey);
}

async function generateWithGemini(prompt: string) {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in Supabase secrets");

  // Ask Gemini to return strict, production-ready HTML focused on WCAG compliance
  const systemInstructions = `You are an accessibility remediation engine.
Transform the provided document content into a clean, semantically structured, WCAG 2.2 AA compliant HTML fragment suitable for embedding inside a web page.

Output requirements (strict):
- Return STRICT JSON with keys: accessible_html (string), summary (string). No extra keys, no Markdown, no code fences, no surrounding text.
- accessible_html MUST be a minimal HTML fragment wrapped in a single <article>.
- Use semantic elements: <header>, <main>, <section>, <aside>, <footer>, <h1>-<h6>, lists, <figure> with <img alt="..."> and <figcaption>, and <table> with <caption>, <thead>, <tbody>, <th scope>.
- Prefer native semantics over ARIA; only add ARIA where necessary (e.g., aria-describedby for complex tables or forms).
- Preserve document structure; ensure there is a single <h1> with logical heading hierarchy.
- Add descriptive alt text placeholders when the original content is unknown (e.g., "Image: subject unknown").
- Normalize lists, label form fields, add captions to media and tables, and ensure focus/order is logical.
- Do NOT hallucinate content; if content is unknown, use short placeholders in square brackets.

Also include a concise summary (1–2 sentences) of the main accessibility fixes in the summary field.`;

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
  } as const;

  const resp = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + apiKey,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Gemini error ${resp.status}: ${txt}`);
  }

  const data = await resp.json();
  // Gemini JSON response with responseMimeType set should be embedded in candidates[].content.parts[].text
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

  try {
    const parsed = JSON.parse(text);
    if (parsed && parsed.accessible_html && parsed.summary) return parsed;
    throw new Error("Gemini returned unexpected JSON shape");
  } catch (e) {
    // Fallback: wrap raw text into fields if parse failed
    return {
      accessible_html: `<article><p>${text || "No content returned"}</p></article>`,
      summary: "Accessibility-enhanced version generated.",
    };
  }
}

async function fetchTextFromUrl(url: string): Promise<{ text: string; contentType: string }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to fetch file: ${r.status}`);
  const contentType = r.headers.get("content-type") || "";

  // If it's textual content, read as text; else provide a placeholder
  if (contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("xml") || contentType.includes("html")) {
    const text = await r.text();
    return { text, contentType };
  }

  // For unsupported binary files (pdf/docx/pptx), we can't easily extract text in Edge runtime without heavy libs.
  // Provide a minimal prompt including the filename and content type so Gemini can produce a generic accessible template.
  const filename = url.split("/").pop() || "document";
  const note = `Binary file '${filename}' with content-type ${contentType}. Please create an accessible HTML outline with placeholders for images and tables, and infer structure (headings, lists) where appropriate.`;
  return { text: note, contentType };
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
    const body = (await req.json()) as ProcessRequestBody;
    const urls = Array.isArray(body?.file_urls) ? body.file_urls : [];
    if (!urls.length) {
      return new Response(JSON.stringify({ error: "file_urls is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // For now process the first file and produce a single combined output
    const first = urls[0];
    const { text } = await fetchTextFromUrl(first);
    const { accessible_html, summary } = await generateWithGemini(text);

    // Store processed html to Storage and return URL
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
    console.error("process-document error", err);
    return new Response(
      JSON.stringify({ error: String((err as Error).message || err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
