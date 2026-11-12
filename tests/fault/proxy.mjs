// A proxy that sits between the two test sites and spoils the answers of the second one on purpose. NOT part of the
// plugin. The first site is given the address of the proxy instead of the address of the second site.
//
//   const proxy = await startProxy( 'https://second-site.test' );   proxy.mode = 'status502';   ... proxy.close();
//
// The modes:
//   pass       forward the request and the answer as they are
//   status502  HTTP 502 with the page of a web server
//   status403  HTTP 403 with the page of a firewall
//   basic      HTTP 401 with a request for a user name and a password
//   empty      HTTP 200 and nothing in the body
//   truncate   the real answer, cut in the middle
//   notice     a PHP notice in front of the real answer
//   redirect   HTTP 302 to another page of the proxy, which is a normal web page
//   reset      the connection is closed without an answer
//   hang       no answer at all (the request runs into its time limit)
//
// The certificate of the second site may be a self-signed one: it is not checked here.

import http from 'node:http';
import https from 'node:https';

export async function startProxy( target ) {

    const to    = new URL( target );
    const proxy = { mode : 'pass', requests : [], url : '', close : () => {} };
    const open  = new Set();

    const forward = ( request, body ) => new Promise( ( resolve, reject ) => {

        const headers = { ...request.headers, host : to.host };

        delete headers['accept-encoding'];

        const outgoing = ( 'https:' === to.protocol ? https : http ).request( { host : to.hostname, port : to.port || ( 'https:' === to.protocol ? 443 : 80 ), path : request.url, method : request.method, headers, rejectUnauthorized : false }, answer => {

            const chunks = [];

            answer.on( 'data', chunk => chunks.push( chunk ) );
            answer.on( 'end', () => resolve( { status : answer.statusCode, headers : answer.headers, body : Buffer.concat( chunks ) } ) );
        } );

        outgoing.on( 'error', reject );
        outgoing.end( body );
    } );

    const server = http.createServer( ( request, response ) => {

        const chunks = [];

        request.on( 'data', chunk => chunks.push( chunk ) );

        request.on( 'end', async () => {

            proxy.requests.push( { mode : proxy.mode, path : request.url, migration : request.headers['x-syncpilot-migration'] || '' } );

            const page = ( status, html, extra = {} ) => {

                response.writeHead( status, { 'Content-Type' : 'text/html; charset=utf-8', 'Content-Length' : Buffer.byteLength( html ), ...extra } );
                response.end( html );
            };

            if ( '/elsewhere' === request.url )
                return page( 200, '<html><head><title>Welcome</title></head><body><h1>Welcome to our shop</h1><p>Open every day.</p></body></html>' );

            if ( 'hang' === proxy.mode )
                return;

            if ( 'reset' === proxy.mode )
                return request.socket.destroy();

            if ( 'status502' === proxy.mode )
                return page( 502, '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx</center></body></html>', { Server : 'nginx' } );

            if ( 'status403' === proxy.mode )
                return page( 403, '<html><body><h1>Request blocked</h1><p>ModSecurity: rule 942100 matched. Reference: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8</p></body></html>', { Server : 'Apache' } );

            if ( 'basic' === proxy.mode )
                return page( 401, '<html><body><h1>401 Unauthorized</h1></body></html>', { 'WWW-Authenticate' : 'Basic realm="staging"' } );

            if ( 'redirect' === proxy.mode )
                return page( 302, '', { Location : `http://user:secret@127.0.0.1:${ proxy.port }/elsewhere` } );

            let answer;

            try {
                answer = await forward( request, Buffer.concat( chunks ) );
            } catch ( error ) {
                return page( 502, '<html><body>the proxy cannot reach the second site: ' + error.message + '</body></html>' );
            }

            let body = answer.body;

            if ( 'empty' === proxy.mode )
                body = Buffer.alloc( 0 );

            if ( 'truncate' === proxy.mode )
                body = body.subarray( 0, Math.floor( body.length / 2 ) );

            if ( 'notice' === proxy.mode )
                body = Buffer.concat( [ Buffer.from( '<br />\n<b>Notice</b>:  Undefined variable: x in <b>/var/www/site/wp-content/plugins/other/other.php</b> on line <b>12</b><br />\n' ), body ] );

            const headers = { ...answer.headers, 'content-length' : body.length };

            delete headers['transfer-encoding'];
            delete headers['content-encoding'];

            response.writeHead( answer.status, headers );
            response.end( body );
        } );
    } );

    server.on( 'connection', socket => { open.add( socket ); socket.on( 'close', () => open.delete( socket ) ); } );

    await new Promise( resolve => server.listen( 0, '127.0.0.1', resolve ) );

    proxy.port  = server.address().port;
    proxy.url   = `http://127.0.0.1:${ proxy.port }`;

    proxy.close = () => {

        for ( const socket of open ) socket.destroy();

        server.close();
    };

    return proxy;
}
