import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/skills'

export const skillRoutes = new Router()

skillRoutes.get('/api/DiTing/skills', ctrl.list)
skillRoutes.get('/api/DiTing/skills/usage/stats', ctrl.usageStats)
skillRoutes.get('/api/DiTing/skills/external-dirs', ctrl.listExternalDirs)
skillRoutes.put('/api/DiTing/skills/external-dirs', ctrl.updateExternalDirs)
skillRoutes.put('/api/DiTing/skills/toggle', ctrl.toggle)
skillRoutes.put('/api/DiTing/skills/pin', ctrl.pin_)
skillRoutes.post('/api/DiTing/skills/import', ctrl.importSkill)
skillRoutes.delete('/api/DiTing/skills/:category/:skill', ctrl.deleteSkill)
skillRoutes.get('/api/DiTing/skills/:category/:skill/files', ctrl.listFiles)
skillRoutes.get('/api/DiTing/skills/{*path}', ctrl.readFile_)
