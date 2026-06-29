import { View, Text, Image } from 'react-native';

interface AvatarProps {
  name?: string;
  surname?: string;
  uri?: string | null;
  size?: number;
  /** Mida de la lletra de les inicials. Per defecte ~40% de `size`. */
  fontSize?: number;
}

/**
 * Avatar reutilitzable: mostra la foto de perfil (`uri`) si existeix, o un
 * cercle amb les inicials del nom/cognoms com a fallback.
 */
export default function Avatar({ name = '', surname = '', uri, size = 48, fontSize }: AvatarProps) {
  const initials = `${name[0] ?? ''}${surname[0] ?? ''}`.toUpperCase();

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#e5e7eb' }}
      />
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: '#15803d',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#ffffff', fontWeight: 'bold', fontSize: fontSize ?? size * 0.4 }}>
        {initials}
      </Text>
    </View>
  );
}
