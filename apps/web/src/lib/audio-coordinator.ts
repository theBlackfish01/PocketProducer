let activeAudio: HTMLAudioElement | null = null

export function claimAudioPlayback(audio: HTMLAudioElement): void {
  if (activeAudio && activeAudio !== audio) activeAudio.pause()
  activeAudio = audio
}

export function releaseAudioPlayback(audio: HTMLAudioElement): void {
  if (activeAudio === audio) activeAudio = null
}
