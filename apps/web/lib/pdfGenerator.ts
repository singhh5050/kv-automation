import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { CompanyOverview } from '@/types'
import { ExportConfig } from '@/components/company/PdfExportModal'

// Wait for images and content to load
const waitForContent = (element: HTMLElement): Promise<void> => {
  return new Promise((resolve) => {
    const images = element.querySelectorAll('img')
    const charts = element.querySelectorAll('svg, canvas')
    
    let loadCount = 0
    const totalElements = images.length + charts.length
    
    if (totalElements === 0) {
      setTimeout(resolve, 500)
      return
    }
    
    const checkComplete = () => {
      loadCount++
      if (loadCount >= totalElements) {
        setTimeout(resolve, 1000) // Give extra time for rendering
      }
    }
    
    images.forEach(img => {
      if (img.complete) {
        checkComplete()
      } else {
        img.onload = checkComplete
        img.onerror = checkComplete
      }
    })
    
    // For charts, just wait a bit
    charts.forEach(() => {
      setTimeout(checkComplete, 300)
    })
  })
}

// Clone and prepare DOM elements for PDF
const cloneElementForPdf = (element: HTMLElement): HTMLElement => {
  const clone = element.cloneNode(true) as HTMLElement
  
  // Reset any problematic styles
  clone.style.position = 'static'
  clone.style.transform = 'none'
  clone.style.transition = 'none'
  clone.style.animation = 'none'
  clone.style.maxWidth = 'none'
  clone.style.width = 'auto'
  
  // Ensure visibility
  clone.style.visibility = 'visible'
  clone.style.opacity = '1'
  clone.style.display = 'block'
  
  // Fix any overflow issues
  const allElements = clone.querySelectorAll('*')
  allElements.forEach(el => {
    const element = el as HTMLElement
    element.style.overflow = 'visible'
  })
  
  return clone
}

// Create custom header section
const createCustomHeaderSection = (customHeader: string): HTMLElement => {
  const div = document.createElement('div')
  div.style.marginBottom = '30px'
  div.style.padding = '20px'
  div.style.background = '#f9fafb'
  div.style.borderRadius = '8px'
  div.style.borderLeft = '4px solid #3b82f6'
  
  const title = document.createElement('h2')
  title.style.margin = '0 0 15px 0'
  title.style.fontSize = '18px'
  title.style.fontWeight = 'bold'
  title.style.color = '#111827'
  title.textContent = 'Executive Summary'
  
  const content = document.createElement('div')
  content.style.color = '#374151'
  content.style.lineHeight = '1.6'
  content.innerHTML = customHeader
  
  div.appendChild(title)
  div.appendChild(content)
  
  return div
}

// Switch to the correct tab and wait for content to load
const switchToTab = async (tabName: string): Promise<void> => {
  return new Promise((resolve) => {
    // Find and click the tab button
    const tabButtons = document.querySelectorAll('button')
    let targetButton: HTMLButtonElement | null = null
    
    tabButtons.forEach(button => {
      const text = button.textContent?.toLowerCase() || ''
      if ((tabName === 'summary' && text.includes('summary')) ||
          (tabName === 'financials' && text.includes('financials')) ||
          (tabName === 'updates' && text.includes('latest updates')) ||
          (tabName === 'captable' && text.includes('cap table'))) {
        targetButton = button
      }
    })
    
    if (targetButton) {
      (targetButton as HTMLButtonElement).click()
      // Wait for tab content to load
      setTimeout(resolve, 1000)
    } else {
      resolve()
    }
  })
}

// Capture content from specific tab
const captureTabContent = async (tabName: string, config: any): Promise<HTMLElement[]> => {
  await switchToTab(tabName)
  
  const elements: HTMLElement[] = []
  
  // Wait a bit more for content to fully render
  await new Promise(resolve => setTimeout(resolve, 500))
  
  // Get the main content area
  const contentArea = document.querySelector('.grid.grid-cols-1.gap-6 .w-full') as HTMLElement
  if (!contentArea) return elements
  
  // Find all content sections in the current tab
  const sections = contentArea.querySelectorAll('.bg-white.rounded-lg.border.border-gray-200')
  
  sections.forEach(section => {
    const element = section as HTMLElement
    const textContent = element.textContent || ''
    
    // Filter based on config
    if (tabName === 'summary') {
      if ((config.sections.summary.subsections.cashMetrics && textContent.includes('Summary')) ||
          (config.sections.summary.subsections.milestones && textContent.includes('Milestones')) ||
          (config.sections.summary.subsections.team && textContent.includes('Team'))) {
        elements.push(cloneElementForPdf(element))
      }
    } else if (tabName === 'financials') {
      if (config.sections.financials.subsections.reports && 
          (textContent.includes('Financial') || textContent.includes('KPI'))) {
        elements.push(cloneElementForPdf(element))
      }
    } else if (tabName === 'updates') {
      if (config.sections.updates.subsections.keyHighlights && 
          textContent.includes('Latest Updates')) {
        elements.push(cloneElementForPdf(element))
      }
    } else if (tabName === 'captable') {
      if (config.sections.capTable.subsections.investors && 
          textContent.includes('Cap Table')) {
        elements.push(cloneElementForPdf(element))
      }
    }
  })
  
  return elements
}

export const generatePDF = async (company: CompanyOverview, config: ExportConfig): Promise<void> => {
  try {
    // Create a container for all content
    const container = document.createElement('div')
    container.style.position = 'absolute'
    container.style.left = '-9999px'
    container.style.top = '0'
    container.style.width = '800px'
    container.style.fontFamily = 'Arial, sans-serif'
    container.style.fontSize = '14px'
    container.style.lineHeight = '1.4'
    container.style.color = '#000'
    container.style.background = '#fff'
    container.style.padding = '20px'
    
    document.body.appendChild(container)
    
    // Add company header (always included)
    const headerElement = document.querySelector('.bg-white.rounded-lg.border.border-gray-200.p-4.mb-6') as HTMLElement
    if (headerElement) {
      const headerClone = cloneElementForPdf(headerElement)
      container.appendChild(headerClone)
    }
    
    // Add custom header if provided
    if (config.customHeader.trim()) {
      const customSection = createCustomHeaderSection(config.customHeader)
      container.appendChild(customSection)
    }
    
    // Capture content from each enabled section
    const allElements: HTMLElement[] = []
    
    if (config.sections.summary.enabled) {
      const summaryElements = await captureTabContent('summary', config)
      allElements.push(...summaryElements)
    }
    
    if (config.sections.financials.enabled) {
      const financialElements = await captureTabContent('financials', config)
      allElements.push(...financialElements)
    }
    
    if (config.sections.updates.enabled) {
      const updateElements = await captureTabContent('updates', config)
      allElements.push(...updateElements)
    }
    
    if (config.sections.capTable.enabled) {
      const capTableElements = await captureTabContent('captable', config)
      allElements.push(...capTableElements)
    }
    
    // Add all captured elements to container
    allElements.forEach(element => {
      container.appendChild(element)
    })
    
    // Wait for all content to load
    await waitForContent(container)
    
    // Generate canvas from container
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      width: 800,
      scrollX: 0,
      scrollY: 0
    })
    
    // Remove temporary container
    document.body.removeChild(container)
    
    // Create PDF
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    })
    
    const imgData = canvas.toDataURL('image/png')
    const imgWidth = 210 // A4 width in mm
    const pageHeight = 295 // A4 height in mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width
    let heightLeft = imgHeight
    
    let position = 0
    
    // Add first page
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
    heightLeft -= pageHeight
    
    // Add additional pages if needed
    while (heightLeft >= 0) {
      position = heightLeft - imgHeight
      pdf.addPage()
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight
    }
    
    // Download the PDF
    const fileName = `${company.company.name.replace(/[^a-z0-9]/gi, '_')}_Report_${new Date().toISOString().split('T')[0]}.pdf`
    pdf.save(fileName)
    
  } catch (error) {
    console.error('Error generating PDF:', error)
    throw new Error('Failed to generate PDF. Please try again.')
  }
}
