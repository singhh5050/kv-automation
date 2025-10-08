import type { Metadata } from 'next'
import { ReactNode } from 'react'
import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from '@clerk/nextjs'
import '../styles/globals.css'

export const metadata: Metadata = {
  title: 'KV Portfolio Management',
  description: 'Khosla Ventures Portfolio Management System',
}

export default function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="font-sans">{children}</body>
      </html>
    </ClerkProvider>
  )
} 