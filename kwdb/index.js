const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');
const koaBody = require('koa-body');
const Koa = require('koa');
const Router = require('koa-router-find-my-way');
const EventEmitter = require('events').EventEmitter;
const levelErrors = require('level-errors');
const http = require('http');

exports.buckets = {};
exports.bucketIds = [];
exports.db = require('level');
exports.app = new Koa();
exports.router = Router();
exports.dbgMsg = new EventEmitter();
exports.log = new EventEmitter();
exports.name = 'kwdb';
exports.memdb = false;
exports.launch = ({ host = 'localhost', port = 8575, sublevel = true, database = process.cwd(), doLog = true, test = false } = {
	host: 'localhost',
	port: 8575,
	sublevel: true,
	database: process.cwd(),
	doLog: true,
	test: false
}) => {
	const { db, app, name, dbgMsg, router, log, memdb } = this;
	let { buckets, bucketIds } = this;
	app.use(koaBody({
		parsedMethods: ['POST','DELETE']
	}));
	if (doLog) {
		// logger
		app.use(async (ctx, next) => {
			await next();
			const rt = ctx.response.get('X-Response-Time');
			log.emit('log', `${ctx.method} ${ctx.url} - ${rt}`);
		});

		//X-Response-Time
		app.use(async (ctx, next) => {
			const start = Date.now();
			await next();
			const ms = Date.now() - start;
			ctx.set('X-Response-Time', `${ms}ms`);
		});
	}
	router.get('/',async ({ response }) => {
		response.body = 'OK';
	});
	router.get('/buckets',async ({ response }) => {
		response.body = bucketIds;
	});
	router.post('/buckets',async ({ request, response }) => {
		const { id, testInitErr = false, testOpenErr = false } = request.body;
		if (testInitErr) {
			db({},(err,db) => {
				if(err instanceof levelErrors.OpenError) {
					dbgMsg.emit('error', err);
					response.status = 500;
					response.body = 'failed to open the required database, please check if the database is already in use';
				} else if(err instanceof levelErrors.InitializationError) {
					dbgMsg.emit('error', err);
					response.status = 500;
					response.body = 'failed to init a new database';
				} else {
					buckets[id] = db;
					bucketIds.push(id);
					response.status = 201;
					response.body = 'OK';
				}
			});
		} else if(testOpenErr) {
			db(path.join(database, id, '.db'),{ createIfMissing: false },(err,db) => {
				if(err instanceof levelErrors.OpenError) {
					dbgMsg.emit('error', err);
					response.status = 500;
					response.body = 'failed to open the required database, please check if the database is already in use';
				} else if(err instanceof levelErrors.InitializationError) {
					dbgMsg.emit('error', err);
					response.status = 500;
					response.body = 'failed to init a new database';
				} else {
					buckets[id] = db;
					bucketIds.push(id);
					response.status = 201;
					response.body = 'OK';
				}
			});
		} else {
			db(path.join(database, id, '.db'),{},(err,db) => {
				if(err instanceof levelErrors.OpenError) {
					dbgMsg.emit('error', err);
					response.status = 500;
					response.body = 'failed to open the required database, please check if the database is already in use';
				} else if(err instanceof levelErrors.InitializationError) {
					dbgMsg.emit('error', err);
					response.status = 500;
					response.body = 'failed to init a new database';
				} else {
					buckets[id] = db;
					bucketIds.push(id);
					response.status = 201;
					response.body = 'OK';
				}
			});
		}
	});
	router.delete('/buckets',async ({ request, response }) => {
		try{
			await buckets[request.body.id].close();
		} catch (e) {
			dbgMsg.emit('error',e);
			response.status = 500;
			response.body = e;
		}
		delete buckets[request.body.id];
		bucketIds = bucketIds.slice(bucketIds.indexOf(request.body.id),bucketIds.indexOf(request.body.id));
		if (!memdb) {
			try {
				await fs.remove('database/' + request.body.id + '.db');
				response.body = null;
			} catch (e) {
				dbgMsg.emit('error', e);
				response.status = 500;
				response.body = err;
			}
		}
	});
	router.get('/buckets/umount/:id', async ({ response, params }) => {
		const body = params;
		try {
			await buckets[body.id].close();
			response.body = 'OK'
		} catch (e) {
			dbgMsg.emit('error',e);
			response.status = 500;
			response.body = e;
		}
	});
	router.post('/buckets/:id', async ({ response, request, params }) => {
		var body = request.body;
		var { id } = params;
		try {
			await buckets[id].put(body.key,body.value)
			response.status = 201;
			response.body = 'OK';
		} catch (e) {
			dbgMsg.emit('error', e);
			response.status = 500;
			response.body = e;
		}
	});
	router.get('/buckets/:id', async ({ response, request, params }) => {
		const { id } = params;
		const { key } = request.query;
		try {
			await buckets[id].get(key);
			response.status = 200;
			response.body = val;
		} catch (e) {
			dbgMsg.emit('error', e);
			if(e.notFound) {
				response.status = 404;
				response.body = 'You are trying to fetch a key that does not exist in this bucket';
			} else {
				response.status = 500;
				response.body = e;
			}
		}
	});
	router.delete('/buckets/:id', async ({ request, response, params }) => {
		const { id } = params;
		const { key } = request.body;
		try {
			await buckets[id].del(key);
			response.status = 204;
			response.body = 'Contnent deleted';
		} catch (e) {
			dbgMsg.emit('error', e);
			response.status = 500;
			response.body = e;
		}
	});
	router.post('/buckets/:id/batch', async ({ request, response, params }) => {
		const { id } = params;
		const { tasks } = request.body;
		try {
			buckets[id].batch(tasks);
		} catch (e) {
			dbgMsg.emit('error', e);
			response.status = 500;
			response.body = e;
		}
	});
	app.use(router.routes());
	const httpServer = test?http.createServer(app.callback()):http.createServer(app.callback()).listen(port, host, () => {
		console.log(`App ${name} listening at port ${port}, host ${host}`);
	});
	return httpServer;
};
