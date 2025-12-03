## Quiz Service (Node.js, Express, MVC, ES Modules)

### Requirements
- Node.js >= 20
- MongoDB (local or cloud)

### Setup
```bash
nvm use 20
npm install
```

### Environment
Create a `.env` file:
```
PORT=4004
LOG_LEVEL=dev
CORS_ORIGIN=*
MONGODB_URI=mongodb://127.0.0.1:27017/quiz_service
SESSION_SECRET=change-me
```

### Run
```bash
npm run dev   # dev with nodemon
npm start     # production
```

### Endpoints
- GET `/health` → service status
- POST `/auth/qr-login` → accept QR JSON payload, issue session cookie
- GET `/auth/me` → return current session claims
- GET `/api/quizzes` → list quizzes
- GET `/api/quizzes/:id` → get quiz
- POST `/api/quizzes` → create quiz `{ title, description?, questions? }`
- PATCH `/api/quizzes/:id` → update quiz fields
- DELETE `/api/quizzes/:id` → delete quiz

Data persisted in MongoDB using Mongoose (`src/models/quiz.model.js`).
