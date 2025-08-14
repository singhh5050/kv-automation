import type { Metadata } from 'next'
import { ReactNode } from 'react'
import '../styles/globals.css'

export const metadata: Metadata = {
  title: 'PDF Finance Summarizer',
  description: 'Upload PDFs and get AI-powered financial summaries',
}

export default function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  )
} 