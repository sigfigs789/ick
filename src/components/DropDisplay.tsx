interface Props {
  drop: string;
}

export function DropDisplay({ drop }: Props) {
  return (
    <div className="drop-display">
      <p className="drop-display__label" id="drop-label">
        Today's ink
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
