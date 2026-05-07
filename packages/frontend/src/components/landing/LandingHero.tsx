import Image from "next/image";
import Link from "next/link";
import { TerminalWindow, TLine, T, Cursor } from "./Terminal";
import styles from "./LandingHero.module.css";

const STATS = [
  { num: "~3-6s", label: "Inspect → Settle" },
  { num: "0", label: "API Accounts Needed" },
  { num: "x402", label: "Gateway Path" },
  { num: "Base", label: "Settlement Layer" },
];

export default function LandingHero() {
  return (
    <section className={styles.hero}>
      <div className={styles.glow} />

      <Image
        src="/chainlens_coin_256.png"
        alt="ChainLens"
        width={64}
        height={64}
        className={styles.coin}
        priority
      />

      <div className={styles.badge}>
        <span className={styles.dot} />
        Live on Base Sepolia
      </div>

      <h1 className={styles.h1}>
        The Payment Layer
        <br />
        for the <span className={styles.hl}>Agent Economy</span>
      </h1>

      <p className={styles.sub}>
        Autonomous AI agents can now <strong>discover, inspect, and pay for</strong> verified APIs
        with a wallet-native flow. Browse live listings, check reliability signals, then settle on
        Base only after the seller response succeeds.
      </p>

      <div className={styles.actions}>
        <Link href="/discover" prefetch className={styles.btnPrimary}>
          Try Testnet
        </Link>
        <a
          href="https://forms.gle/EtCpnWtRcMeM7UtC7"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.btnSecondary}
        >
          Join Mainnet Waitlist
        </a>
      </div>

      <div className={styles.directoryCta}>
        <span>Provider team?</span>
        <a
          href="https://github.com/Chain-Lens/awesome-onchain-data-providers"
          target="_blank"
          rel="noopener noreferrer"
        >
          Add your API to the open GitHub directory
        </a>
        <span>or</span>
        <a href="/register">register a paid listing</a>
      </div>

      <div className={styles.termWrap}>
        <TerminalWindow title="agent.js — ChainLens quickstart">
          <TLine>
            <T.cmt>{"// Agent-native API purchase: discover → inspect → call"}</T.cmt>
          </TLine>
          <TLine />
          <TLine>
            <T.kw>const</T.kw> <T.val>listings</T.val> <T.out>= await</T.out>{" "}
            <T.cmd>chainLens</T.cmd>
            <T.out>.</T.out>
            <T.ok>discover</T.ok>
            <T.out>({"{"} q: </T.out>
            <T.str>&quot;defillama&quot;</T.str>
            <T.out> {"}"});</T.out>
          </TLine>
          <TLine>
            <T.cmt>{'// → [{ listingId: "3", priceUsdc: "0.050000 USDC", ... }]'}</T.cmt>
          </TLine>
          <TLine />
          <TLine>
            <T.kw>const</T.kw> <T.val>detail</T.val> <T.out>= await</T.out> <T.cmd>chainLens</T.cmd>
            <T.out>.</T.out>
            <T.ok>inspect</T.ok>
            <T.out>({"{"} listing_id: </T.out>
            <T.str>&quot;3&quot;</T.str>
            <T.out> {"}"});</T.out>
          </TLine>
          <TLine>
            <T.kw>const</T.kw> <T.val>out</T.val> <T.out>= await</T.out> <T.cmd>chainLens</T.cmd>
            <T.out>.</T.out>
            <T.ok>call</T.ok>
            <T.out>({"{"} listing_id: </T.out>
            <T.str>&quot;3&quot;</T.str>
            <T.out>, amount: </T.out>
            <T.str>&quot;50000&quot;</T.str>
            <T.out>, inputs: {"{"} protocol: </T.out>
            <T.str>&quot;uniswap&quot;</T.str>
            <T.out>
              {" "}
              {"}"} {"}"});
            </T.out>
          </TLine>
          <TLine />
          <TLine>
            <T.cmt>{"// Gateway executes seller → settles on Base only on success"}</T.cmt>
          </TLine>
          <TLine>
            <T.ok>✓ Response received · Safety checks passed · Market settled</T.ok> <Cursor />
          </TLine>
        </TerminalWindow>
      </div>

      <div className={styles.stats}>
        {STATS.map((s) => (
          <div key={s.label} className={styles.stat}>
            <div className={styles.statNum}>{s.num}</div>
            <div className={styles.statLabel}>{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
