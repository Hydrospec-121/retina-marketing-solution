# Retina Marketing Solution

A beginner-friendly starter project for the Retina Marketing Solution website.

## What is included

- Public medicine catalogue starter page
- Admin dashboard starter page
- Teal Healthcare visual design system
- Responsive layout for desktop and mobile
- Sample medicines and dashboard figures for demonstration

## Important: current project status

This ZIP is a **front-end starter/demo**, not a production-ready pharmacy e-commerce or accounting system yet.

It does not currently include:
- A real database or persistent stock records
- Admin login, employee permissions, or secure authentication
- Real order submission, payment processing, or delivery integration
- Batch/expiry-aware stock operations
- Accounting, invoices, or regulatory compliance workflows

Do not use the sample data for real business operations. These features will be implemented and tested in later development stages.

## Requirements

- Node.js LTS
- Visual Studio Code
- A web browser

## Run on Windows

1. Extract the ZIP file.
2. Open Visual Studio Code.
3. Select **File → Open Folder** and choose the extracted `retina-marketing-solution` folder.
4. Select **Terminal → New Terminal**.
5. Run:

   ```powershell
   npm install
   ```

6. When installation finishes, run:

   ```powershell
   npm run dev
   ```

7. Open the address shown in the terminal, usually http://localhost:3000

To stop the development server, click the terminal and press `Ctrl + C`.

## Publish to GitHub

1. Sign in at https://github.com
2. Create a new repository named `retina-marketing-solution`.
3. Keep it **Private** while the project is being developed.
4. Do not initialize it with a README, .gitignore, or license (this ZIP already contains project files).
5. In VS Code, open the project folder and use **Source Control → Initialize Repository**.
6. Stage the files, write a commit message such as `Initial Retina website starter`, and commit.
7. Choose **Publish Branch** and follow the GitHub sign-in prompts.

Alternatively, install Git for Windows and use:

   ```powershell
   git init
   git add .
   git commit -m "Initial Retina website starter"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/retina-marketing-solution.git
   git push -u origin main
   ```

Replace `YOUR-USERNAME` with your GitHub username.

## Design system

- Deep Teal: `#103D3C`
- Healthcare Teal: `#168C83`
- Soft Mint: `#9DE3D8`
- Light Mint: `#F1F8F6`
- Fresh Lime: `#C8F36A`
- Near Black: `#111817`

## Next development milestones

1. Connect a PostgreSQL database and implement secure admin authentication.
2. Build real medicine, manufacturer, batch, and supplier management.
3. Implement guest checkout and persistent orders.
4. Add stock reservation, dispatch, returns, and expiry controls.
5. Add accounting, payment records, reports, and audit logs.
6. Review Bangladesh pharmaceutical and online-sales requirements before launch.
