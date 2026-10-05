/** Hands the viewer a text file to save, named `filename`. */
export function saveText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // The click starts the download synchronously; the URL is not needed after it.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
