'use client';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { preparePhoto } from '../../../../lib/image';
import { Button, LiveRegion } from '../../../../components/ui';
export function HistoricalPhotoPicker({ disabled, onChange, onPreparing }: {
  disabled: boolean;
  onChange: (photo?: Blob) => void;
  onPreparing: (value: boolean) => void;
}) {
  const [chosen, setChosen] = useState<{
    blob: Blob;
    url: string;
  }>();
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string>();
  const camera = useRef<HTMLInputElement>(null), library = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (chosen)
    URL.revokeObjectURL(chosen.url); }, [chosen]);
  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget, file = input.files?.[0];
    input.value = '';
    if (!file)
      return;
    setPreparing(true);
    onPreparing(true);
    setError(undefined);
    try {
      const blob = await preparePhoto(file);
      setChosen({ blob, url: URL.createObjectURL(blob) });
      onChange(blob);
    }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that photo.');
    }
    finally {
      setPreparing(false);
      onPreparing(false);
    }
  };
  return <div><p className="text-sm font-bold">Photo <span className="font-normal text-muted">(optional)</span></p>
  <input ref={camera} type="file" accept="image/*" capture="environment" aria-label="Take photo using camera" className="sr-only" onChange={choose} disabled={disabled || preparing}/>
  <input ref={library} type="file" accept="image/*" aria-label="Choose photo from library" className="sr-only" onChange={choose} disabled={disabled || preparing}/>
  {chosen ? <div className="my-3">{/* Local blob handles cannot use the image optimizer. */}
   {/* eslint-disable-next-line @next/next/no-img-element */}
   <img src={chosen.url} alt="Your selected notable-win photo" className="max-h-72 w-full rounded-xl border border-divider object-contain"/>
   <Button variant="quiet" disabled={disabled || preparing} onClick={() => { setChosen(undefined); onChange(undefined); setError(undefined); }}>Remove selected photo</Button></div>
      : <div className="my-3 rounded-xl border border-dashed border-muted/60 p-6 text-center text-sm text-muted">No photo yet<p className="mt-2 text-xs">Add a photo of the hand. You can also do this later.</p></div>}
  <div className="flex flex-wrap gap-3"><Button variant="secondary" disabled={disabled || preparing} onClick={() => camera.current?.click()}>Take photo</Button><Button variant="secondary" disabled={disabled || preparing} onClick={() => library.current?.click()}>Choose from library</Button></div>
  <LiveRegion tone={error ? 'error' : 'info'} message={error ?? (preparing ? 'Preparing photo…' : undefined)}/>
 </div>;
}
