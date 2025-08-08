import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { CheckCircle2, FileText, Loader2, Settings, Volume2, Square } from 'lucide-react';

interface LocationState {
  files?: File[];
}

const steps = [
  { key: 'upload', label: 'Uploading to secure storage' },
  { key: 'analyze', label: 'Running AI accessibility analysis' },
  { key: 'fix', label: 'Applying fixes and tagging' },
  { key: 'complete', label: 'Finalizing accessible document' },
] as const;

const Analyze: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { files = [] } = (location.state as LocationState) || {};

  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [done, setDone] = useState(false);

  const [originalPreview, setOriginalPreview] = useState('');
  const [accessiblePreview, setAccessiblePreview] = useState('');
  const [summary, setSummary] = useState('');
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const fileNames = useMemo(() => files.map((f) => f.name), [files]);

  const handleNarrate = () => {
    const text = accessiblePreview || summary;
    if (!text) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utteranceRef.current = utterance;
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      setIsSpeaking(false);
    }
  };

  const handleStopNarration = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  useEffect(() => {
    if (!files.length) return;

    let p = 0;
    let s = 0;
    const interval = setInterval(() => {
      p = Math.min(100, p + Math.floor(Math.random() * 9) + 4);
      setProgress(p);
      if (p > (s + 1) * 25 && s < steps.length - 1) {
        s += 1;
        setCurrentStep(s);
      }
      if (p >= 100) {
        clearInterval(interval);
        setDone(true);
      }
    }, 450);

    return () => clearInterval(interval);
  }, [files.length]);

  useEffect(() => {
    if (!done) return;
    // Placeholder previews – replace with Edge Function response
    const names = fileNames.join(', ');
    setOriginalPreview(`Original document preview for: ${names}\n\n(This demo preview is limited. Connect Supabase + Gemini to enable real extraction.)`);
    setAccessiblePreview(
      "Accessible version:\n\n" +
      "- Proper heading levels (H1-H3) applied\n" +
      "- Reading order corrected\n" +
      "- Form fields labeled\n" +
      "- Alt text suggestions added\n\n" +
      "Body:\n" +
      "This document has been cleaned for clarity and optimized for screen readers."
    );
    setSummary(
      "Summary: The document structure was normalized, interactive elements labeled, and contrast/reading order validated. It’s now easier to navigate and understand."
    );
  }, [done, fileNames]);

  // If user navigates here directly
  if (!files.length) {
    return (
      <main className="min-h-screen bg-background">
        <Helmet>
          <title>Analyze Documents | Accessible AI</title>
          <meta name="description" content="Upload documents for AI-powered accessibility analysis and remediation." />
          <link rel="canonical" href="/analyze" />
        </Helmet>
        <section className="container mx-auto px-4 py-16">
          <h1 className="text-3xl font-bold text-foreground mb-4">No files to process</h1>
          <p className="text-muted-foreground mb-6">Please upload a document first.</p>
          <Button onClick={() => navigate('/')}>Back to upload</Button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>Processing Your Document | Accessible AI</title>
        <meta name="description" content="Processing and fixing document accessibility using AI. Live progress and final results." />
        <link rel="canonical" href="/analyze" />
      </Helmet>

      <section className="container mx-auto px-4 py-16">
        <header className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-foreground">Making your document accessible</h1>
          <p className="text-muted-foreground mt-2">We’re analyzing and remediating accessibility issues automatically.</p>
        </header>

        <article className="bg-card border rounded-lg p-6 shadow-medium">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-primary animate-spin-slow" />
              <span className="text-sm font-medium text-foreground">{steps[currentStep].label}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {fileNames.map((name, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-accent-light text-foreground">
                  <FileText className="w-3 h-3" />
                  {name}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <Progress value={progress} />
            <p className="text-xs text-muted-foreground mt-2">{progress}% complete</p>
          </div>

          {!done ? (
            <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Working… This usually takes under a minute.
            </div>
          ) : (
            <div className="mt-8 space-y-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-success" />
                <div>
                  <h2 className="text-xl font-semibold text-foreground">Accessibility fixes applied</h2>
                  <p className="text-muted-foreground mt-1">
                    Fantastic work—your content is now more inclusive. Headings normalized, reading order corrected,
                    forms labeled, and alt text suggestions generated.
                  </p>
                </div>
              </div>

              {summary && (
                <article className="bg-accent-light/40 border rounded-md p-4">
                  <h3 className="text-base font-medium text-foreground">Concise summary</h3>
                  <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{summary}</p>
                </article>
              )}

              <section className="grid md:grid-cols-2 gap-4">
                <article className="bg-muted/30 border rounded-md p-4">
                  <h3 className="text-sm font-semibold text-foreground">Original</h3>
                  <div className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">
                    {originalPreview || "Original preview will appear here once processing is enabled."}
                  </div>
                </article>
                <article className="bg-card border rounded-md p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-foreground">Accessible version</h3>
                  <div className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">
                    {accessiblePreview || "Accessible output will appear here after AI processing."}
                  </div>
                </article>
              </section>

              <div className="flex flex-wrap gap-3">
                <Button>
                  Download accessible version
                </Button>
                <Button variant="secondary" onClick={() => navigate('/')}>
                  Process another document
                </Button>
                <Button variant="outline" onClick={() => (isSpeaking ? handleStopNarration() : handleNarrate())}>
                  {isSpeaking ? (
                    <>
                      <Square className="w-4 h-4 mr-2" />
                      Stop narration
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-4 h-4 mr-2" />
                      Narrate document
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </article>

        <aside className="mt-8 text-sm text-muted-foreground">
          Note: For real AI processing, connect Supabase and add your GEMINI_API_KEY to Edge Function Secrets. Upload files to Supabase Storage, then call an Edge Function (Gemini) to extract, fix, summarize, and return accessible output and preview HTML. This screen will display those results.
        </aside>
      </section>
    </main>
  );
};

export default Analyze;
