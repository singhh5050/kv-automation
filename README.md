# Portfolio Company Financial Analysis Tool

A modern web application that processes PDF financial documents from biotech and healthcare portfolio companies using AI-powered analysis. The app automatically groups multiple reports per company and provides timeline navigation through different reporting periods.

## Features

### Multi-Report Company Management
- 🏢 **Company Grouping**: Automatically groups PDFs by company using intelligent name matching
- 📅 **Report Timeline**: Handles multiple board decks per company sorted chronologically  
- 🔄 **Historical Navigation**: Navigate between different reporting periods with arrow controls
- 📊 **Latest Data Display**: Company cards show the most recent financial metrics
- ⌨️ **Keyboard Support**: Arrow keys for navigation, Escape to close modals

### Advanced PDF Processing with pdfplumber
- 📊 **Superior Table Extraction**: Advanced table detection and parsing for financial data
- 🎯 **Precise Text Positioning**: Maintains exact character and layout information
- 📄 **Multi-page Support**: Handles complex documents with consistent formatting
- 🔍 **Structured Data**: Extracts tables as structured JSON with headers and rows
- ⚡ **Robust Parsing**: Better handling of complex PDF layouts than basic text extraction

### AI-Powered Financial Analysis
- 🤖 **OpenAI Integration**: Uses GPT-4 for intelligent PDF analysis and data extraction
- 💰 **Financial Metrics**: Cash position, burn rate, runway, and budget performance
- 🧬 **Clinical Progress**: Detailed analysis with enrollment numbers, trial phases, and dates
- 🔬 **R&D Intelligence**: Platform capabilities, development timelines, and patent metrics
- 📈 **Biotech Focus**: Specialized prompts for healthcare and biotech terminology

### Competitive Intelligence (NEW)
- 🔍 **Harmonic API Integration**: Real-time competitive landscape analysis
- 🏢 **Company Discovery**: Automatically finds competitors for portfolio companies
- 📊 **Headcount Estimates**: Track competitor team size and growth
- 📰 **Latest News**: Real-time news monitoring for competitive intelligence

### User Interface
- 💳 **Card View**: Clean grid layout showing key metrics at a glance
- 🔍 **Detailed Modal**: Tabbed interface for comprehensive analysis
- 🗂️ **Report Indicator**: Shows number of reports and current period being viewed
- 📱 **Responsive Design**: Works on desktop, tablet, and mobile devices
- 💾 **Local Storage**: Data persists across browser sessions

## Key Metrics Displayed

- **Cash on Hand** - Most important raw number for financial health
- **Monthly Burn Rate** - Determines pace of cash use
- **Cash Out Date** - The investor's clock showing when funds run out
- **Runway (in months)** - Useful shorthand derived from cash and burn rate
- **Budget vs. Actual Spend** - Signals fiscal discipline or drift

## Tech Stack

- **Frontend**: Next.js 14, React, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes
- **AI**: OpenAI GPT-4 for intelligent document analysis
- **Competitive Intelligence**: Harmonic API for real-time market data
- **PDF Processing**: Python pdfplumber for advanced text and table extraction
- **File Upload**: formidable for handling multipart uploads
- **Data Persistence**: Browser localStorage with JSON serialization
- **Deployment**: Vercel with serverless functions

## Getting Started

### Prerequisites

- Node.js 18+ installed
- Python 3.8+ installed
- npm or yarn package manager
- OpenAI API key (required for PDF analysis)
- Harmonic API key (required for competitive intelligence)

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd kv-automation
   ```

2. **Install Node.js dependencies**
   ```bash
   npm install
   ```

3. **Set up Python environment**
   ```bash
   # Option 1: Use the setup script (recommended)
   chmod +x setup_python.sh
   ./setup_python.sh
   
   # Option 2: Manual setup
   pip3 install -r requirements.txt
   ```

4. **Set up environment variables**
   Create a `.env.local` file in the root directory:
   ```bash
   touch .env.local
   ```
   
   Add your API keys to the file:
   ```
   # OpenAI API Key for PDF analysis
   OPENAI_API_KEY=your_openai_api_key_here
   
   # Harmonic API Key for competitive intelligence
   HARMONIC_API_KEY=your_harmonic_api_key_here
   ```
   
   **Important Security Notes:**
   - Never commit `.env.local` to version control
   - Keep your API keys secure and private
   - The `.env.local` file is automatically ignored by Git

5. **Run the development server**
   ```bash
   npm run dev
   ```

6. **Open your browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

## Deployment

### Deploy to Vercel

This app is optimized for deployment on Vercel with built-in support for serverless functions.

1. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```

2. **Deploy to Vercel**
   - Connect your GitHub repository to Vercel
   - Vercel will automatically detect this as a Next.js project
   - Add environment variables in Vercel dashboard:
     - `OPENAI_API_KEY`
     - `HARMONIC_API_KEY`

3. **Environment Variables in Vercel**
   In your Vercel dashboard, add these environment variables:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   HARMONIC_API_KEY=your_harmonic_api_key_here
   ```

The Python dependencies will be automatically installed by Vercel during deployment.

## Usage

### Uploading Multiple Reports
1. **Upload PDFs**: Click the "Add PDFs" button or drag and drop PDF files
2. **Automatic Grouping**: Reports are automatically grouped by company name
3. **Company Cards**: Each company gets one card showing latest financial data
4. **Report Count**: Cards display total number of reports per company

### Navigating Company Data
1. **Open Modal**: Click any company card to view detailed analysis
2. **Report Navigation**: Use arrow buttons to navigate between different periods
3. **Keyboard Navigation**: 
   - `←` Previous report (older)
   - `→` Next report (newer)  
   - `Escape` Close modal
4. **Tab Views**: Switch between Financial, Clinical Progress, R&D, and Competitive Intelligence

### Competitive Intelligence
1. **Automatic Analysis**: When viewing company details, competitive data loads automatically
2. **Competitor Discovery**: See similar companies in the same space
3. **Headcount Tracking**: Monitor competitor team size and growth trends
4. **News Monitoring**: Stay updated with latest competitor developments

### Company Matching Algorithm
The system intelligently groups reports using:
- **Name Normalization**: Removes Corp, Inc, Ltd variations
- **Fuzzy Matching**: Handles partial matches and substring matching
- **Smart Grouping**: "ABC Corp" matches "ABC Corporation" automatically
