export async function extractTextFromFile(file: File): Promise<{ text: string; contentType: string }> {
  const contentType = file.type || '';

  // Read simple textual files directly
  if (
    contentType.startsWith('text/') ||
    contentType.includes('json') ||
    contentType.includes('xml') ||
    contentType.includes('html')
  ) {
    const text = await file.text();
    return { text, contentType };
  }

  // PDF: extract text client-side using pdfjs-dist
  if (contentType === 'application/pdf') {
    try {
      const pdfjsLib: any = await import('pdfjs-dist');
      // Use CDN worker to avoid bundling complexity
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.js';

      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
      const pdf = await loadingTask.promise;

      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const strings = content.items.map((item: any) => item.str).filter(Boolean);
        fullText += strings.join(' ') + '\n\n';
      }

      return { text: fullText.trim(), contentType };
    } catch (e) {
      // Fall through to generic handler
    }
  }

  // DOCX: convert to HTML first, then let model improve semantics
  if (contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    try {
      const mammoth: any = await import('mammoth/mammoth.browser');
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      // Provide HTML to preserve structure; model will normalize semantics
      const html = result.value as string;
      return { text: html, contentType };
    } catch (e) {
      // Fall through to generic handler
    }
  }

  // Fallback: unsupported type
  const name = file.name || 'document';
  const note = `Unsupported file '${name}' with content-type ${contentType}.`;
  return { text: note, contentType };
}
