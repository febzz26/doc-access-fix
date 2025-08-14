import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TranslateRequest {
  content: string;
  targetLanguage: string;
  sourceLanguage?: string;
}

const languageNames: Record<string, string> = {
  'es': 'Spanish',
  'fr': 'French',
  'de': 'German',
  'it': 'Italian',
  'pt': 'Portuguese',
  'ru': 'Russian',
  'ja': 'Japanese',
  'ko': 'Korean',
  'zh': 'Chinese (Simplified)',
  'ar': 'Arabic',
  'hi': 'Hindi',
  'pl': 'Polish',
  'nl': 'Dutch',
  'sv': 'Swedish',
  'da': 'Danish',
  'no': 'Norwegian',
  'fi': 'Finnish',
  'cs': 'Czech',
  'tr': 'Turkish',
  'he': 'Hebrew',
  'th': 'Thai',
  'vi': 'Vietnamese',
  'uk': 'Ukrainian',
  'bg': 'Bulgarian',
  'hr': 'Croatian',
  'sk': 'Slovak',
  'sl': 'Slovenian',
  'et': 'Estonian',
  'lv': 'Latvian',
  'lt': 'Lithuanian'
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { content, targetLanguage, sourceLanguage = 'en' } = await req.json() as TranslateRequest;

    if (!content || !targetLanguage) {
      return new Response(
        JSON.stringify({ error: "Content and target language are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Translating content to ${targetLanguage}`);

    const targetLangName = languageNames[targetLanguage] || targetLanguage;
    const sourceLangName = languageNames[sourceLanguage] || sourceLanguage;

    const systemPrompt = `You are a professional translator specializing in accessible documents. 

Your task:
1. Translate the provided HTML content from ${sourceLangName} to ${targetLangName}
2. Preserve ALL HTML structure, tags, and attributes exactly as they are
3. Only translate the text content within HTML tags
4. Maintain accessibility features (alt text, aria labels, headings hierarchy)
5. Ensure cultural appropriateness and accuracy
6. Keep technical terms and proper nouns when appropriate

CRITICAL RULES:
- Preserve HTML structure completely
- Translate only text content, not HTML tags or attributes
- Maintain semantic meaning and accessibility
- Return only the translated HTML content, no additional text or formatting

Input content to translate:
${content}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: systemPrompt
          }
        ],
        max_tokens: 4000,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API error:", errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const translatedContent = data.choices?.[0]?.message?.content || "";

    if (!translatedContent) {
      throw new Error("No translation received from OpenAI");
    }

    console.log(`Translation completed. Content length: ${translatedContent.length}`);

    return new Response(
      JSON.stringify({
        translatedContent,
        targetLanguage,
        sourceLanguage
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("Translation error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Translation failed" 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});