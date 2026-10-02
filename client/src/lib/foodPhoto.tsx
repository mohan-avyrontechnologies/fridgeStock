import { useEffect, useState } from 'react';
import { api } from '../api/client';

/**
 * Product photos are private: they are only served to a signed-in member of the household, so an <img src>
 * pointing at the server can't load them (an image tag can't send the login token). Instead the photo is
 * fetched with the token and shown through an object URL, which is revoked when the component goes away
 * (or the photo changes), so the browser doesn't keep every picture it has shown.
 */
export function useFoodPhotoUrl(foodId: string, photoAt: string | null, size: 'thumb' | 'full'): string | null {
  const key = photoAt ? `${foodId}|${photoAt}|${size}` : null;
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!key || !photoAt) return;
    let current = true;
    let objectUrl: string | null = null;
    api.foodPhoto(foodId, size, photoAt).then(
      (blob) => {
        if (!current) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ key, url: objectUrl });
      },
      () => {}, // A photo that can't be loaded is simply not shown.
    );
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key, foodId, photoAt, size]);

  return loaded && loaded.key === key ? loaded.url : null;
}

/** A food item's photo (the thumbnail or the full picture), or an empty placeholder while it loads. */
export function FoodPhoto({
  foodId,
  photoAt,
  name,
  size,
  className = '',
}: {
  foodId: string;
  photoAt: string | null;
  name: string;
  size: 'thumb' | 'full';
  className?: string;
}) {
  const url = useFoodPhotoUrl(foodId, photoAt, size);
  return url ? (
    <img src={url} alt={`Photo of ${name}`} className={`bg-paper ${className}`} />
  ) : (
    <div aria-hidden className={`bg-paper ${className}`} />
  );
}

/** A picture held in memory (a photo just taken, not saved yet), shown through an object URL that is revoked afterwards. */
export function BlobThumb({ blob, alt, className = '' }: { blob: Blob; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    // An object URL is a resource that has to be made and released with the component, so it is set here.
    const objectUrl = URL.createObjectURL(blob);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return url ? <img src={url} alt={alt} className={className} /> : <div aria-hidden className={className} />;
}
