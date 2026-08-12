import { version } from 'unpdf/pdfjs'

const pdfWorkerScope = globalThis as typeof globalThis & {
  __agentarborPdfWorkerVersion?: string
}

// Keep the bundled PDF.js module in this worker entry; it initializes its
// message handler when evaluated in a dedicated WorkerGlobalScope.
pdfWorkerScope.__agentarborPdfWorkerVersion = version