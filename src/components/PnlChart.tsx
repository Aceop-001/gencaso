"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtMoney } from "@/lib/format";

export function PnlChart({ data }: { data: Array<{ date: string; net: number; cumulative: number }> }) {
  if (data.length < 2) return <div className="flex h-56 items-center justify-center text-sm text-ink-3">Not enough activity in this tax year to chart.</div>;
  const last = data[data.length - 1].cumulative;
  const stroke = last >= 0 ? "#38e1ff" : "#ff6b8a";
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(120,160,255,0.07)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "#6a7aa6", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={48} />
          <YAxis tick={{ fill: "#6a7aa6", fontSize: 11 }} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => fmtMoney(v, "USD", "en-US", 0)} />
          <Tooltip
            contentStyle={{ background: "#0a1228", border: "1px solid rgba(120,180,255,.26)", borderRadius: 12, fontSize: 12 }}
            labelStyle={{ color: "#a3b1d6" }}
            formatter={(v: number, name: string) => [fmtMoney(v), name === "cumulative" ? "Cumulative net" : "Day net"]}
          />
          <Area type="monotone" dataKey="cumulative" stroke={stroke} strokeWidth={1.8} fill="url(#pnlFill)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
