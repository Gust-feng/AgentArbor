export function loadDocxDocumentSurface() {
  return import('./DocxDocumentSurface').then((module) => ({ default: module.DocxDocumentSurface }))
}

export function loadSpreadsheetDocumentSurface() {
  return import('./SpreadsheetDocumentSurface').then((module) => ({ default: module.SpreadsheetDocumentSurface }))
}
