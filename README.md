# 🩺 MedRAG — Medical Learning Assistant

An AI-powered medical learning assistant built for university medical students. It combines **Retrieval-Augmented Generation (RAG)** with multiple AI models to help students prepare for exams, analyze clinical cases, and explore the latest medical research.

![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![Groq](https://img.shields.io/badge/Groq-LLM-orange)
![Gemini](https://img.shields.io/badge/Google-Gemini-4285F4?logo=google&logoColor=white)
![Pinecone](https://img.shields.io/badge/Pinecone-Vector_DB-00C7B7)

---

## ✨ Features

### 🤖 AI Tools
| Tool | Description |
|------|-------------|
| **General Chat** | Conversational AI (like ChatGPT) for quick medical queries and symptom advice |
| **Study Mode** | Structured exam prep with 5-mark short notes and 15-mark long essays |
| **Web Search** | Latest research from PubMed with PMID citations |
| **OPD Assistant** | Clinical case analysis with differential diagnosis and management plans |

### 🩺 OPD Patient Management
- Full-screen patient management panel
- Create and store patient profiles with clinical details (vitals, history, examination)
- **AI-powered clinical analysis** rendered directly inside the OPD panel
- Structured output: Summary → Suspected Diagnosis → Differentials → Investigations → Management
- Mobile/iPad optimized for bedside use

### 🔍 Search Modes
- **Hybrid** — Combines medical textbooks + PubMed research
- **Textbooks Only** — Focus on foundational knowledge from uploaded PDFs
- **PubMed Only** — Latest peer-reviewed research articles

### 📚 Multi-Model Support
- **Groq**: Llama 3.3 70B, Llama 3.1 8B, GPT-OSS 120B, Mixtral 8x7B
- **Google Gemini**: Gemini Pro, Gemini 1.5 Flash/Pro, Gemini 2.0 Flash

---

## 🏗️ Architecture

```
medical-learning-assistant/
├── backend/
│   ├── main.py                  # FastAPI server with SSE streaming
│   ├── config.py                # Environment configuration (Pydantic)
│   ├── agents/
│   │   ├── synthesis.py         # Multi-provider LLM synthesis (Groq/Gemini)
│   │   ├── retrieval.py         # Textbook vector search agent
│   │   ├── document_processor.py # PDF chunking & embedding pipeline
│   │   ├── pubmed_search.py     # PubMed API search agent
│   │   └── query_analyzer.py    # Intent classification (conversational vs medical)
│   ├── database/
│   │   ├── mysql_db.py          # MySQL for metadata & caching
│   │   ├── pinecone_db.py       # Pinecone vector database
│   │   └── init.sql             # Database schema
│   └── utils/
├── frontend/
│   ├── index.html               # Main UI with OPD panel
│   ├── styles.css               # Dark glassmorphism theme
│   └── scripts.js               # Client-side logic & OPD management
├── uploads/                     # Uploaded medical textbook PDFs
├── pyproject.toml               # Python dependencies (uv)
└── .env                         # API keys (not committed)
```

---

## 🚀 Getting Started

### Prerequisites
- **Python 3.11+**
- **MySQL** (local or remote)
- **uv** package manager (`pip install uv`)
- API keys for: **Groq**, **Pinecone**, and optionally **Google Gemini**

### 1. Clone & Setup

```bash
git clone https://github.com/yourusername/medical-learning-assistant.git
cd medical-learning-assistant
uv sync
```

### 2. Configure Environment

Create a `.env` file in the project root:

```env
GROQ_API_KEY=your_groq_api_key
PINECONE_API_KEY=your_pinecone_api_key
GEMINI_API_KEY=your_gemini_api_key        # Optional
MYSQL_HOST=localhost
MYSQL_USER=root
MYSQL_PASSWORD=your_mysql_password
MYSQL_DATABASE=medical_learning_db
```

### 3. Setup Database

```sql
CREATE DATABASE medical_learning_db;
```

Then run the init script:
```bash
mysql -u root -p medical_learning_db < backend/database/init.sql
```

### 4. Start the Backend

```bash
uv run uvicorn backend.main:app --reload
```

The API will be available at `http://localhost:8000`.

### 5. Open the Frontend

Open `frontend/index.html` with a Live Server (e.g., VS Code Live Server extension) at `http://127.0.0.1:5500/frontend/index.html`.

### 6. Upload Textbooks

Upload medical textbook PDFs through the web UI or via the API endpoint:
```bash
curl -X POST http://localhost:8000/upload -F "file=@your_textbook.pdf"
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Health check & system stats |
| `POST` | `/query/stream` | Stream AI response (SSE) |
| `POST` | `/query` | Non-streaming response |
| `POST` | `/upload` | Upload medical textbook PDF |
| `GET` | `/books` | List all uploaded books |
| `DELETE` | `/books/{book_id}` | Delete a book |
| `GET` | `/stats` | System statistics |
| `GET` | `/health` | Detailed health check |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | FastAPI, Python 3.11+ |
| **LLM Providers** | Groq (Llama, Mixtral), Google Gemini |
| **Embeddings** | Sentence Transformers (all-MiniLM-L6-v2) |
| **Vector DB** | Pinecone |
| **Relational DB** | MySQL |
| **PDF Processing** | PyPDF2, pdfplumber |
| **Frontend** | Vanilla HTML/CSS/JS |
| **Research** | PubMed E-Utilities API |

---

## 📝 License

This project is for educational purposes only. Always consult healthcare professionals for medical advice.
