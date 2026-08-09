interface Props {
  fragment: string;
}

export function FragmentDisplay({ fragment }: Props) {
  return (
    <div className="fragment-display">
      <p className="fragment-display__label" id="fragment-label">
        Today's fragment
      </p>
      <p className="fragment-display__value" aria-labelledby="fragment-label">
        {fragment.split("").map((ch, i) => (
          <span className="fragment-display__letter" key={i}>
            {ch}
          </span>
        ))}
      </p>
    </div>
  );
}
