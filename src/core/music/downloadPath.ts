import { existsFile, externalStorageDirectoryPath } from '@/utils/fs'
import { filterFileName } from '@/utils/common'
import { formatMusicName } from '@/utils/tools'
import settingState from '@/store/setting/state'

export const DOWNLOAD_DIR = `${externalStorageDirectoryPath}/Music/LxMusic`

export const getDownloadFileName = (musicInfo: LX.Music.MusicInfoOnline) => {
  return filterFileName(formatMusicName(settingState.setting['download.fileName'], musicInfo.name, musicInfo.singer))
}

// 已下载过的歌曲直接播放本地文件，省流量、没网也能听
export const getDownloadedFilePath = async(musicInfo: LX.Music.MusicInfoOnline) => {
  const name = getDownloadFileName(musicInfo)
  for (const ext of ['flac', 'mp3']) {
    const path = `${DOWNLOAD_DIR}/${name}.${ext}`
    if (await existsFile(path).catch(() => false)) return path
  }
  return null
}
