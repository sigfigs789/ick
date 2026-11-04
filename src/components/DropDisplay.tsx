import { formatDateLabel } from "../game/date";

interface Props {
  drop: string;
  date?: string;
  isToday?: boolean;
}

export function DropDisplay({ drop, date, isToday = true }: Props) {
  return (
    <div className="drop-display">
      <p className="drop-display__label" id="drop-label">
        {!isToday && date ? `${formatDateLabel(date)}'s drop` : "Today's drop"}
      </p>
      <p className="drop-display__value" aria-labelledby="drop-label">
        {drop.split("").map((ch, i) => (
          <span className="drop-display__letter" key={i}>
            {ch}
          </span>
        ))}
      </p>
    </div>
  );
}
