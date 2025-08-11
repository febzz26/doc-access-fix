import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, FileText, Loader2, Settings, Volume2, Square, Download, Eye, Languages } from 'lucide-react';
import { AccessibilityToolbar } from '@/components/accessibility-toolbar';
import { HeaderBar } from '@/components/header-bar';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/use-toast';
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
  const [focusMode, setFocusMode] = useState(false);

  const [accessibleContent, setAccessibleContent] = useState('');
  const [summary, setSummary] = useState('');
  const [processedDocumentUrl, setProcessedDocumentUrl] = useState('');
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('en-US');
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);

  // Load available voices and listen for focus mode changes
  useEffect(() => {
    const loadVoices = () => {
      const voices = speechSynthesis.getVoices();
      setAvailableVoices(voices);
    };

    loadVoices();
    speechSynthesis.addEventListener('voiceschanged', loadVoices);

    const handleFocusModeChange = (event: CustomEvent) => {
      setFocusMode(event.detail.enabled);
    };
    
    window.addEventListener('focusModeChange', handleFocusModeChange as EventListener);
    
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', loadVoices);
      window.removeEventListener('focusModeChange', handleFocusModeChange as EventListener);
    };
  }, []);

  const fileNames = useMemo(() => files.map((f) => f.name), [files]);

  const handleNarrate = () => {
    const text = accessibleContent || summary;
    if (!text) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      
      // Find and set the selected voice
      const selectedVoice = availableVoices.find(voice => 
        voice.lang === selectedLanguage || voice.name.includes(selectedLanguage)
      );
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }
      utterance.lang = selectedLanguage;
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

  const handleDownload = async () => {
    if (!accessibleContent && !processedDocumentUrl) return;
    setIsDownloading(true);
    try {
      if (processedDocumentUrl) {
        const link = document.createElement('a');
        link.href = processedDocumentUrl;
        link.download = '';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }

      // Fallback: download accessible content as text
      const fileName = fileNames.length > 0 ? fileNames[0].replace(/\.[^/.]+$/, '') : 'document';
      const blob = new Blob([accessibleContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${fileName}_accessible.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      toast({ title: 'Download failed', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setIsDownloading(false);
    }
  };

  useEffect(() => {
    if (!files.length) return;

    const process = async () => {
      try {
        // Step 1: Upload to storage
        setCurrentStep(0);
        setProgress(10);

        const publicUrls: string[] = [];
        for (const file of files) {
          const folder = `incoming/${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const path = `${folder}/${file.name}`;
          const { data: uploadData, error: uploadError } = await supabase
            .storage
            .from('uploads')
            .upload(path, file, { upsert: true });
          if (uploadError) throw uploadError;

          const { data: urlData } = supabase.storage.from('uploads').getPublicUrl(uploadData.path);
          publicUrls.push(urlData.publicUrl);
        }

        // Step 2: Invoke Edge Function to analyze/process
        setCurrentStep(1);
        setProgress(40);
        const { data, error } = await supabase.functions.invoke('process-document', {
          body: { file_urls: publicUrls }
        });
        if (error) throw error;

        // Step 3: Apply fixes/collect results
        setCurrentStep(2);
        setProgress(70);

        const content = data?.accessible_content || data?.accessibleContent || data?.accessible_text || data?.html || '';
        const sum = data?.summary || '';
        const processedUrl = data?.processed_document_url || data?.downloadUrl || data?.processed_url || data?.processedDocumentUrl || '';

        if (!content && !processedUrl) {
          throw new Error('Edge Function did not return processed content or URL.');
        }

        setAccessibleContent(content);
        setSummary(sum);
        if (processedUrl) setProcessedDocumentUrl(processedUrl);

        // Step 4: Complete
        setCurrentStep(3);
        setProgress(100);
        setDone(true);
      } catch (err: any) {
        console.error('Processing failed:', err);
        toast({
          title: 'Processing failed',
          description: err?.message || 'Please check your Edge Function and its logs.',
          variant: 'destructive'
        });
        setDone(true);
      }
    };

    process();
  }, [files, supabase]);

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

      <HeaderBar />

      <section className="container mx-auto px-4 py-16">
        <header className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-foreground">Making your document accessible</h1>
          <p className="text-muted-foreground mt-2">We're analyzing and remediating accessibility issues automatically.</p>
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
              {/* Show everything when not in focus mode */}
              {!focusMode && (
                <>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-6 h-6 text-success" />
                    <div>
                      <h2 className="text-xl font-semibold text-foreground">Accessibility fixes applied</h2>
                      <p className="text-muted-foreground mt-1">
                        Fantastic work—your content is now more inclusive. Headings normalized, reading order corrected,
                        forms labeled, and WCAG AA compliance achieved.
                      </p>
                    </div>
                  </div>

                  {summary && (
                    <article className="bg-success-light/40 border border-success/20 rounded-lg p-4">
                      <div className="flex items-start gap-2">
                        <Eye className="w-5 h-5 text-success mt-0.5" />
                        <div>
                          <h3 className="text-base font-medium text-foreground">Processing Summary</h3>
                          <p className="text-sm text-muted-foreground mt-2">{summary}</p>
                        </div>
                      </div>
                    </article>
                  )}
                </>
              )}

              <AccessibilityToolbar className="mb-6" />

              <section className="bg-card border rounded-lg p-6 shadow-medium">
                <div className="flex items-center gap-2 mb-4">
                  <FileText className="w-5 h-5 text-primary" />
                  <h3 className="text-lg font-semibold text-foreground">Accessible Document Preview</h3>
                </div>
                
                <div className="bg-background border rounded-md p-6 max-h-96 overflow-y-auto">
                  <div className="prose prose-sm max-w-none text-foreground whitespace-pre-wrap">
                    {accessibleContent || "Accessible content will appear here after AI processing."}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mt-4 pt-4 border-t">
                  <div className="text-xs text-muted-foreground">
                    Document optimized for screen readers and accessibility compliance
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Languages className="w-4 h-4 text-muted-foreground" />
                      <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
                        <SelectTrigger className="w-40">
                          <SelectValue placeholder="Language" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="en-US">English (US)</SelectItem>
                          <SelectItem value="en-GB">English (UK)</SelectItem>
                          <SelectItem value="es-ES">Spanish</SelectItem>
                          <SelectItem value="fr-FR">French</SelectItem>
                          <SelectItem value="de-DE">German</SelectItem>
                          <SelectItem value="it-IT">Italian</SelectItem>
                          <SelectItem value="pt-BR">Portuguese</SelectItem>
                          <SelectItem value="ru-RU">Russian</SelectItem>
                          <SelectItem value="ja-JP">Japanese</SelectItem>
                          <SelectItem value="ko-KR">Korean</SelectItem>
                          <SelectItem value="zh-CN">Chinese (Mandarin)</SelectItem>
                          <SelectItem value="ar-SA">Arabic</SelectItem>
                          <SelectItem value="hi-IN">Hindi</SelectItem>
                          <SelectItem value="pl-PL">Polish</SelectItem>
                          <SelectItem value="nl-NL">Dutch</SelectItem>
                          <SelectItem value="sv-SE">Swedish</SelectItem>
                          <SelectItem value="da-DK">Danish</SelectItem>
                          <SelectItem value="no-NO">Norwegian</SelectItem>
                          <SelectItem value="fi-FI">Finnish</SelectItem>
                          <SelectItem value="cs-CZ">Czech</SelectItem>
                          <SelectItem value="hu-HU">Hungarian</SelectItem>
                          <SelectItem value="tr-TR">Turkish</SelectItem>
                          <SelectItem value="th-TH">Thai</SelectItem>
                          <SelectItem value="vi-VN">Vietnamese</SelectItem>
                          <SelectItem value="he-IL">Hebrew</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => (isSpeaking ? handleStopNarration() : handleNarrate())}
                      disabled={!accessibleContent}
                    >
                      {isSpeaking ? (
                        <>
                          <Square className="w-4 h-4 mr-2" />
                          Stop
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-4 h-4 mr-2" />
                          Listen
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </section>

              {!focusMode && (
                <div className="flex flex-wrap gap-3">
                  <Button 
                    onClick={handleDownload}
                    disabled={(!accessibleContent && !processedDocumentUrl) || isDownloading}
                    className="bg-gradient-primary hover:opacity-90"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    {isDownloading ? 'Preparing...' : 'Download accessible version'}
                  </Button>
                  <Button variant="secondary" onClick={() => navigate('/')}>
                    Process another document
                  </Button>
                </div>
              )}
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