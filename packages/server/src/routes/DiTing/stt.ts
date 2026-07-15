import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/stt'

export const sttProtectedRoutes = new Router()

sttProtectedRoutes.get('/api/DiTing/stt/settings', ctrl.listSettings)
sttProtectedRoutes.get('/api/DiTing/stt/profile-status', ctrl.profileStatus)
sttProtectedRoutes.get('/api/DiTing/stt/profile-status/missing-audio', ctrl.missingProfileAudio)
sttProtectedRoutes.post('/api/DiTing/mcu/voice-turn', ctrl.mcuVoiceTurn)
sttProtectedRoutes.put('/api/DiTing/stt/settings/active', ctrl.saveActiveProvider)
sttProtectedRoutes.put('/api/DiTing/stt/settings/:provider', ctrl.saveSettings)
sttProtectedRoutes.delete('/api/DiTing/stt/settings/:provider', ctrl.deleteProvider)
sttProtectedRoutes.delete('/api/DiTing/stt/settings/:provider/base-url-preset', ctrl.deleteBaseUrlPreset)
sttProtectedRoutes.delete('/api/DiTing/stt/settings/:provider/secret/:secretName', ctrl.deleteSecret)
sttProtectedRoutes.post('/api/DiTing/stt/transcribe', ctrl.transcribe)
