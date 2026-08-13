interface Props {
  text: string;
  onShared?: () => void;
}

/** Opens Twitter's composer with a result containing a Twitter-tagged URL. */
export function TwitterShareButton({ text, onShared }: Props) {
  const href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;

  return (
    <a
      className="share-button"
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={onShared}
    >
      Share on Twitter
    </a>
  );
}
