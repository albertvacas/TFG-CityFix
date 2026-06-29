interface AvatarProps {
  name?: string;
  surname?: string;
  url?: string | null;
  /** Mida en píxels (amplada i alçada). Per defecte 40. */
  size?: number;
  className?: string;
}

/**
 * Avatar reutilitzable: mostra la foto de perfil (`url`) si existeix, o un
 * cercle amb les inicials del nom/cognoms com a fallback.
 */
export default function Avatar({ name = '', surname = '', url, size = 40, className = '' }: AvatarProps) {
  const initials = `${name[0] ?? ''}${surname[0] ?? ''}`.toUpperCase();
  const style = { width: size, height: size, fontSize: size * 0.4 } as const;

  if (url) {
    return (
      <img
        src={url}
        alt={`${name} ${surname}`}
        style={{ width: size, height: size }}
        className={`shrink-0 rounded-full object-cover bg-gray-100 ${className}`}
      />
    );
  }

  return (
    <span
      style={style}
      className={`flex shrink-0 items-center justify-center rounded-full bg-indigo-600 font-bold text-white ${className}`}
    >
      {initials}
    </span>
  );
}
