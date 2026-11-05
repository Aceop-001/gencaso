/**
 * Roadmap teaser for the community, shown in the header's ⋯ menu. These are plans, not features:
 * nothing here is wired up, and each one is labelled "Soon" so no one mistakes it for something live.
 */
export const ROADMAP_ITEMS: { title: string; body: string; icon: React.ReactNode }[] = [
  {
    title: "More chains",
    body: "Solana, Base, Arbitrum and more wallets in one combined report.",
    icon: <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />,
  },
  {
    title: "CeFi taxation",
    body: "Bring centralised-exchange history in alongside your on-chain trades.",
    icon: <><path d="M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" /><path d="M12 3l9 5H3z" /></>,
  },
  {
    title: "Yield farming & more protocols",
    body: "Staking, liquidity pools, lending and airdrops, taxed under your country's rules.",
    icon: <><path d="M12 21V11" /><path d="M12 11c0-4 3-7 8-7 0 5-3 8-8 7zM12 14c0-3-2.5-5.5-7-5.5 0 4 2.5 6 7 5.5z" /></>,
  },
  {
    title: "Catch on-chain scammers",
    body: "Work with your government to trace and flag scam wallets on-chain.",
    icon: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  },
  {
    title: "Find your CA",
    body: "Match with a crypto-savvy chartered accountant in your country for quick confirmation.",
    icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
  },
  {
    title: "Surf fish: live API usage",
    body: "A Surf-powered fish that swims beside your results and shows live API calls per second.",
    icon: <><path d="M3 12c3-4.5 8-6 12.5-3.5L21 6v12l-5.5-2.5C11 18 6 16.5 3 12z" /><circle cx="8" cy="11" r=".9" fill="currentColor" stroke="none" /></>,
  },
  {
    title: "Web3 & AI hackathons",
    body: "Remote Web3 and AI hackathons that are open to builders in your country.",
    icon: <><path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13.5 6l-3 12" /></>,
  },
];
