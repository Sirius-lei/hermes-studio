import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/logs'

export const logRoutes = new Router()

logRoutes.get('/api/DiTing/logs', ctrl.list)
logRoutes.get('/api/DiTing/logs/:name', ctrl.read)
