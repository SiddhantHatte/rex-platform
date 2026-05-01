# Rex Cybersecurity Instructor

Rex is a strict accountability platform for the 30-day cybersecurity plan.

## Providers

- Gemini judges evidence and regression answers.
- OpenAI writes polished GitHub portfolio Markdown after approval.
- Perplexity checks whether resources, certifications, and learning paths are current.
- GitHub stores approved writeups in a separate portfolio repository.

## Local Run

```powershell
cd "C:\Users\hatte\Downloads\Elite sec Reasearch\rex-platform"
copy .env.example .env
notepad .env
npm start
```

Open `http://localhost:3000`.

Never commit `.env`. API keys belong only in local `.env` or Render environment secrets.

## Required Environment Variables

```env
REX_ADMIN_PASSWORD=choose-a-long-password
SESSION_SECRET=generate-a-long-random-secret
GEMINI_API_KEY=your-gemini-key
GEMINI_MODEL=gemini-3-flash-preview
OPENAI_API_KEY=your-openai-key
OPENAI_MODEL=gpt-5.5
PERPLEXITY_API_KEY=your-perplexity-key
PERPLEXITY_MODEL=sonar
GITHUB_TOKEN=github-token-with-contents-write
GITHUB_OWNER=SiddhantHatte
GITHUB_PORTFOLIO_REPO=cybersecurity-portfolio
GITHUB_BRANCH=main
```

## GitHub Setup

Create two repositories:

- `SiddhantHatte/rex-platform`
- `SiddhantHatte/cybersecurity-portfolio`

Create a GitHub token with contents read/write access to `cybersecurity-portfolio`, then set it as `GITHUB_TOKEN`.

## Render Setup

- Runtime: Node web service
- Build command: `npm install`
- Start command: `npm start`
- Environment: paste the variables above into Render secrets
- Node version: `22.22.0`

The server binds to `process.env.PORT` on `0.0.0.0`, which is required for Render web services.
