import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/workflows'

export const workflowRoutes = new Router()

workflowRoutes.get('/api/DiTing/workflows', ctrl.list)
workflowRoutes.post('/api/DiTing/workflows', ctrl.create)
workflowRoutes.post('/api/DiTing/workflows/batch-delete', ctrl.batchRemove)
workflowRoutes.get('/api/DiTing/workflows/:id/runs', ctrl.listRuns)
workflowRoutes.post('/api/DiTing/workflows/:id/runs/:runId/stop', ctrl.stopRun)
workflowRoutes.post('/api/DiTing/workflows/:id/runs/:runId/rerun-from-node', ctrl.rerunFromNode)
workflowRoutes.delete('/api/DiTing/workflows/:id/runs/:runId', ctrl.deleteRun)
workflowRoutes.post('/api/DiTing/workflows/:id/run', ctrl.runNow)
workflowRoutes.get('/api/DiTing/workflows/:id', ctrl.get)
workflowRoutes.patch('/api/DiTing/workflows/:id', ctrl.update)
workflowRoutes.delete('/api/DiTing/workflows/:id', ctrl.remove)
