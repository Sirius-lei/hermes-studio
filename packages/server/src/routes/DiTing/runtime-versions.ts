import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/runtime-versions'
import { requireSuperAdmin } from '../../middleware/user-auth'

export const runtimeVersionRoutes = new Router()

runtimeVersionRoutes.get('/api/DiTing/runtime-versions', requireSuperAdmin, ctrl.status)
runtimeVersionRoutes.get('/api/DiTing/runtime-versions/jobs', requireSuperAdmin, ctrl.jobs)
runtimeVersionRoutes.get('/api/DiTing/runtime-versions/jobs/:id', requireSuperAdmin, ctrl.job)
runtimeVersionRoutes.post('/api/DiTing/runtime-versions/active-runtime', requireSuperAdmin, ctrl.activateRuntime)
runtimeVersionRoutes.post('/api/DiTing/runtime-versions/active-webui', requireSuperAdmin, ctrl.activateWebUi)
runtimeVersionRoutes.post('/api/DiTing/runtime-versions/runtime/download', requireSuperAdmin, ctrl.downloadRuntime)
runtimeVersionRoutes.post('/api/DiTing/runtime-versions/webui/download', requireSuperAdmin, ctrl.downloadWebUi)
runtimeVersionRoutes.delete('/api/DiTing/runtime-versions/runtime/:version', requireSuperAdmin, ctrl.deleteRuntime)
runtimeVersionRoutes.delete('/api/DiTing/runtime-versions/webui/:version', requireSuperAdmin, ctrl.deleteWebUi)
