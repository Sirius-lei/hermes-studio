import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/write-gate'

export const writeGateRoutes = new Router()

writeGateRoutes.get('/api/DiTing/write-gate/pending', ctrl.list)
writeGateRoutes.get('/api/DiTing/write-gate/pending/:subsystem/:id/diff', ctrl.diff)
writeGateRoutes.post('/api/DiTing/write-gate/pending/:subsystem/:id/approve', ctrl.approve)
writeGateRoutes.post('/api/DiTing/write-gate/pending/:subsystem/:id/reject', ctrl.reject)
