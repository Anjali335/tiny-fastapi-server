# 🚀 Tiny FastAPI Server

A clean, production-ready REST API starter server built with **FastAPI** and **Uvicorn**, featuring automated OpenAPI/Swagger documentation, schema validation, and health monitoring.

---

## 📋 Features

- ⚡ **High Performance**: Built on top of Starlette and Pydantic.
- 📖 **Interactive API Docs**: Built-in Swagger UI (`/docs`) and ReDoc (`/redoc`).
- 🩺 **Health Check Route**: Ready for Docker, Kubernetes, or cloud deployment monitoring.
- 🛡️ **Data Validation**: Strict request/response typing using Pydantic models.
- 📦 **Isolated Environment**: Standard `.venv` setup with clean `.gitignore`.

---

## 🛠️ Quickstart

### 1. Clone & Navigate
```bash
git clone https://github.com/<your-username>/<your-repo-name>.git
cd tiny-fastapi-server
```

### 2. Activate Virtual Environment
- **Windows (PowerShell)**:
  ```powershell
  .\.venv\Scripts\Activate.ps1
  ```
- **macOS / Linux**:
  ```bash
  source .venv/bin/activate
  ```

### 3. Install Dependencies
```bash
pip install -r requirements.txt
```

### 4. Run the Server
```bash
python main.py
```
Or via uvicorn directly:
```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

---

## 📡 API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Root endpoint showing status and doc links |
| `GET` | `/health` | Health check endpoint returning UTC timestamp |
| `GET` | `/api/greet/{name}` | Dynamic greeting endpoint with query parameter |
| `POST` | `/api/echo` | JSON payload echoing with Pydantic validation |
| `GET` | `/docs` | Interactive Swagger UI API documentation |
| `GET` | `/redoc` | Alternative ReDoc documentation |

---

## 🧪 Testing the API

Once the server is running, open your browser or API client:
- **Swagger UI**: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- **Health Check**: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)
