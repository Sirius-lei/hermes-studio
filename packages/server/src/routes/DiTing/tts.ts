import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/tts'

export const ttsRoutes = new Router()
export const ttsProtectedRoutes = new Router()

ttsRoutes.post('/api/DiTing/tts', ctrl.generate)
ttsRoutes.post('/api/tts/proxy/audio/speech', ctrl.openaiProxy)
ttsRoutes.get('/api/DiTing/mcu/audio/:file', ctrl.mcuAudio)

ttsProtectedRoutes.get('/api/DiTing/tts/settings', ctrl.listSettings)
ttsProtectedRoutes.put('/api/DiTing/tts/settings/active', ctrl.saveActiveProvider)
ttsProtectedRoutes.put('/api/DiTing/tts/settings/:provider', ctrl.saveSettings)
ttsProtectedRoutes.delete('/api/DiTing/tts/settings/:provider', ctrl.deleteProvider)
ttsProtectedRoutes.delete('/api/DiTing/tts/settings/:provider/base-url-preset', ctrl.deleteBaseUrlPreset)
ttsProtectedRoutes.delete('/api/DiTing/tts/settings/:provider/secret/:secretName', ctrl.deleteSecret)
ttsProtectedRoutes.post('/api/voice/providers/probe', ctrl.probeProvider)
ttsProtectedRoutes.post('/api/DiTing/tts/synthesize', ctrl.synthesize)
