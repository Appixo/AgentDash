import './globals.css';

export const metadata = {
  title: 'AgentDash',
  description: 'Real-time observability dashboard for autonomous AI agents.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="font-mono antialiased">{children}</body>
    </html>
  );
}
