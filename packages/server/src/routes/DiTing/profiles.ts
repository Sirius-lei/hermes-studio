import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/profiles'
import { requireSuperAdmin } from '../../middleware/user-auth'

export const profileRoutes = new Router()

profileRoutes.get('/api/DiTing/profiles', ctrl.list)
profileRoutes.post('/api/DiTing/profiles', ctrl.create)
profileRoutes.get('/api/DiTing/profiles/runtime-statuses', ctrl.runtimeStatuses)
profileRoutes.get('/api/DiTing/profiles/:name/runtime-status', ctrl.runtimeStatus)
profileRoutes.post('/api/DiTing/profiles/:name/restart', ctrl.restartProfileRuntime)
profileRoutes.post('/api/DiTing/profiles/:name/gateway/restart', ctrl.restartGatewayForProfile)
profileRoutes.put('/api/DiTing/profiles/:name/avatar', ctrl.updateAvatar)
profileRoutes.delete('/api/DiTing/profiles/:name/avatar', ctrl.deleteAvatar)
profileRoutes.get('/api/DiTing/profiles/:name', ctrl.get)
profileRoutes.delete('/api/DiTing/profiles/:name', ctrl.remove)
profileRoutes.post('/api/DiTing/profiles/:name/rename', ctrl.rename)
profileRoutes.put('/api/DiTing/profiles/active', requireSuperAdmin, ctrl.switchProfile)
profileRoutes.post('/api/DiTing/profiles/:name/export', ctrl.exportProfile)
profileRoutes.post('/api/DiTing/profiles/import', ctrl.importProfile)
