import { existsFile, externalStorageDirectoryPath } from '@/utils/fs'
import { filterFileName } from '@/utils/common'
import { formatMusicName } from '@/utils/tools'
import settingState from '@/store/setting/state'

export const DOWNLOAD_DIR = `${externalStorageDirectoryPath}/Music/LzMusic`

const FILE_NAME_FORMATS: Array<LX.AppSetting['download.fileName']> = ['歌名 - 歌手', '歌手 - 歌名', '歌名']

export const getDownloadFileName = (musicInfo: LX.Music.MusicInfoOnline, format = settingState.setting['download.fileName']) => {
  return filterFileName(formatMusicName(format, musicInfo.name, musicInfo.singer))
}

// 已下载过的歌曲直接播放本地文件，省流量、没网也能听
export const getDownloadedFilePath = async(musicInfo: LX.Music.MusicInfoOnline) => {
  // 当前命名格式优先，其次兼容改设置之前用其他格式下载的文件
  const formats = [settingState.setting['download.fileName'], ...FILE_NAME_FORMATS.filter(f => f != settingState.setting['download.fileName'])]
  for (const format of formats) {
    const name = getDownloadFileName(musicInfo, format)
    for (const ext of ['flac', 'mp3']) {
      const path = `${DOWNLOAD_DIR}/${name}.${ext}`
      if (await existsFile(path).catch(() => false)) return path
    }
  }
  return null
}
