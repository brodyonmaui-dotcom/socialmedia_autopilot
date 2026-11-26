/** What the Studio page hands the client (mirrors S1's loadStudioClips row and listSounds). */
export interface StudioClip { mediaId: string; name: string; folder: string | null; durationS: number; posterUrl?: string | null; hasAudio?: boolean }
export interface StudioSound { id: string; name: string; durationS: number | null }
