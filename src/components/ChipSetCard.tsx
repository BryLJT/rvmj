import { DENOMS, PER_PLAYER, STACK_TOTAL, TABLE_QTY, TABLE_TOTAL } from '../lib/chips';

/** Spec §6.7 — rendered entirely from chips.ts so the page can never drift from the checker. */
export function ChipSetCard() {
  return (
    <div className="rounded-lg border p-4">
      <h2 className="mb-2 font-semibold">The standard chip set</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left opacity-60">
            <th>Chip</th><th className="text-right">Worth</th>
            <th className="text-right">Per player</th><th className="text-right">On the table</th>
          </tr>
        </thead>
        <tbody>
          {DENOMS.map((d) => (
            <tr key={d} className="border-t">
              <td className="py-1">${d}</td>
              <td className="text-right">{d} pt{d > 1 ? 's' : ''}</td>
              <td className="text-right">{PER_PLAYER[d]}</td>
              <td className="text-right">{TABLE_QTY[d]}</td>
            </tr>
          ))}
          <tr className="border-t font-medium">
            <td className="py-1">Stack</td><td />
            <td className="text-right">{STACK_TOTAL} pts</td>
            <td className="text-right">{TABLE_TOTAL} pts</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs opacity-60">Chip worth = printed number. Every payment the rules can name is payable in chips.</p>
    </div>
  );
}
