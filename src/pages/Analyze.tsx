import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { CheckCircle2, FileText, Loader2, Settings } from 'lucide-react';

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

  const fileNames = useMemo(() => files.map((f) => f.name), [files]);

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
            <div className="mt-8">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-success" />
                <div>
                  <h2 className="text-xl font-semibold text-foreground">Accessibility fixes applied</h2>
                  <p className="text-muted-foreground mt-1">Headings structured, alt text suggestions generated, color contrast validated, and tags added for screen readers.</p>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Button>Download accessible version</Button>
                <Button variant="secondary" onClick={() => navigate('/')}>Process another document</Button>
              </div>
            </div>
          )}
        </article>

        <aside className="mt-8 text-sm text-muted-foreground">
          Note: To enable real AI processing, connect Supabase and add your Perplexity API key to Edge Function Secrets. Then replace the simulated stepper with a call to your Edge Function.
        </aside>
      </section>
    </main>
  );
};

export default Analyze;
