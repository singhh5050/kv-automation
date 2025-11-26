'use client'

import React, { useState, useEffect, useRef } from 'react'

interface QueryResult {
  question: string
  response: string
  data: any[]
  sql_executed: string
  row_count: number
  timestamp: string
}

export default function VoiceQueryInterface() {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [queryHistory, setQueryHistory] = useState<QueryResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSpeaking, setIsSpeaking] = useState(false)
  
  const recognitionRef = useRef<any>(null)
  const synthRef = useRef<SpeechSynthesis | null>(null)
  
  // Initialize speech recognition
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition()
        recognition.continuous = false
        recognition.interimResults = true
        recognition.lang = 'en-US'
        
        recognition.onresult = (event: any) => {
          const transcript = Array.from(event.results)
            .map((result: any) => result[0])
            .map((result: any) => result.transcript)
            .join('')
          
          setTranscript(transcript)
          
          // If final result, process the query
          if (event.results[0].isFinal) {
            handleVoiceQuery(transcript)
          }
        }
        
        recognition.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error)
          setError(`Voice recognition error: ${event.error}`)
          setIsListening(false)
        }
        
        recognition.onend = () => {
          setIsListening(false)
        }
        
        recognitionRef.current = recognition
      } else {
        setError('Speech recognition not supported in this browser. Please use Chrome or Edge.')
      }
      
      synthRef.current = window.speechSynthesis
    }
  }, [])
  
  const startListening = () => {
    if (recognitionRef.current) {
      setTranscript('')
      setError(null)
      setIsListening(true)
      recognitionRef.current.start()
    }
  }
  
  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      setIsListening(false)
    }
  }
  
  const handleVoiceQuery = async (question: string) => {
    if (!question.trim()) return
    
    setIsProcessing(true)
    setError(null)
    
    try {
      console.log('🎤 Sending voice query:', question)
      
      const response = await fetch('/api/voice-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'query',
          question: question
        })
      })
      
      const result = await response.json()
      
      if (result.error) {
        setError(result.error)
        speak('Sorry, I encountered an error processing your query.')
        return
      }
      
      console.log('✅ Query result:', result)
      
      // Add to history
      const queryResult: QueryResult = {
        question: result.question,
        response: result.response,
        data: result.data,
        sql_executed: result.sql_executed,
        row_count: result.row_count,
        timestamp: new Date().toISOString()
      }
      
      setQueryHistory(prev => [queryResult, ...prev])
      
      // Speak the response
      speak(result.response)
      
    } catch (error: any) {
      console.error('❌ Voice query error:', error)
      setError(error.message || 'Failed to process voice query')
      speak('Sorry, I encountered an error.')
    } finally {
      setIsProcessing(false)
      setTranscript('')
    }
  }
  
  const speak = (text: string) => {
    if (synthRef.current) {
      // Cancel any ongoing speech
      synthRef.current.cancel()
      
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 1.0
      utterance.pitch = 1.0
      utterance.volume = 1.0
      
      utterance.onstart = () => setIsSpeaking(true)
      utterance.onend = () => setIsSpeaking(false)
      utterance.onerror = () => setIsSpeaking(false)
      
      synthRef.current.speak(utterance)
    }
  }
  
  const stopSpeaking = () => {
    if (synthRef.current) {
      synthRef.current.cancel()
      setIsSpeaking(false)
    }
  }
  
  const handleTextQuery = async () => {
    if (transcript.trim()) {
      await handleVoiceQuery(transcript)
    }
  }
  
  return (
    <div className="max-w-6xl mx-auto">
      {/* Voice Input Section */}
      <div className="bg-white rounded-lg shadow-lg p-8 mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Ask About Your Portfolio</h2>
        
        {/* Error Display */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}
        
        {/* Voice Input Controls */}
        <div className="flex items-center gap-4 mb-4">
          {!isListening ? (
            <button
              onClick={startListening}
              disabled={isProcessing}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
            >
              <span className="text-xl">🎤</span>
              <span>Start Voice Query</span>
            </button>
          ) : (
            <button
              onClick={stopListening}
              className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors animate-pulse"
            >
              <span className="text-xl">⏹</span>
              <span>Stop Listening</span>
            </button>
          )}
          
          {isSpeaking && (
            <button
              onClick={stopSpeaking}
              className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm transition-colors"
            >
              <span>🔇</span>
              <span>Stop Speaking</span>
            </button>
          )}
          
          {isProcessing && (
            <div className="flex items-center gap-2 text-gray-600">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
              <span className="text-sm">Processing query...</span>
            </div>
          )}
        </div>
        
        {/* Transcript Display */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Your Question:
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleTextQuery()}
              placeholder="Or type your question here..."
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={isListening || isProcessing}
            />
            <button
              onClick={handleTextQuery}
              disabled={!transcript.trim() || isProcessing}
              className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
            >
              Send
            </button>
          </div>
        </div>
        
        {/* Example Questions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm font-medium text-blue-900 mb-2">Try asking:</p>
          <div className="flex flex-wrap gap-2">
            {[
              "How many companies are in the portfolio?",
              "List the first 10 companies alphabetically.",
              "Show five companies with their stages.",
              "Show the five most recent financial reports uploaded.",
              "Show the five most recent company notes."
            ].map((example, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setTranscript(example)
                  handleVoiceQuery(example)
                }}
                disabled={isProcessing}
                className="px-3 py-1 bg-white border border-blue-300 hover:bg-blue-100 text-blue-700 rounded-full text-xs transition-colors disabled:opacity-50"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {/* Query History */}
      {queryHistory.length > 0 && (
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Query History</h3>
          
          <div className="space-y-4">
            {queryHistory.map((result, idx) => (
              <div key={idx} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                {/* Question */}
                <div className="flex items-start gap-3 mb-3">
                  <span className="text-2xl">❓</span>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{result.question}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(result.timestamp).toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() => speak(result.response)}
                    className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-xs transition-colors"
                  >
                    🔊 Replay
                  </button>
                </div>
                
                {/* Response */}
                <div className="flex items-start gap-3 mb-3 ml-8">
                  <span className="text-2xl">💬</span>
                  <div className="flex-1">
                    <p className="text-gray-700">{result.response}</p>
                  </div>
                </div>
                
                {/* Data Preview */}
                {result.data && result.data.length > 0 && (
                  <div className="ml-8 mt-3 bg-gray-50 rounded p-3">
                    <details>
                      <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                        📊 View Data ({result.row_count} rows)
                      </summary>
                      <div className="mt-2 overflow-x-auto">
                        <pre className="text-xs text-gray-600">
                          {JSON.stringify(result.data.slice(0, 5), null, 2)}
                          {result.data.length > 5 && `\n... and ${result.data.length - 5} more rows`}
                        </pre>
                      </div>
                    </details>
                  </div>
                )}
                
                {/* SQL Query */}
                <div className="ml-8 mt-2 bg-gray-50 rounded p-3">
                  <details>
                    <summary className="cursor-pointer text-xs font-mono text-gray-600 hover:text-gray-900">
                      🔍 View SQL Query
                    </summary>
                    <pre className="mt-2 text-xs text-gray-600 overflow-x-auto">
                      {result.sql_executed}
                    </pre>
                  </details>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}



