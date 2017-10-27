// console.log("starting 0\n");

// // Create a repo by creating a plain object.
// var repo = {};


// // This provides extra methods for dealing with packfile streams.
// // It depends on
// // - unpack(packStream, opts) => hashes
// // - pack(hashes, opts) => packStream
// require('js-git/mixins/pack-ops')(repo);


// // This combines parallel requests for the same resource for effeciency under load.
// require('js-git/mixins/read-combiner')(repo);

// -----

var run = require('gen-run');

run(function*() {
    console.log("starting");

    var httpTransport = require('js-git/net/transport-http')(require('js-git/net/request-xhr'));
    var fetchpack = require('js-git/net/git-fetch-pack')
    var codec = require('js-git/lib/object-codec');
    var makeChannel = require('culvert');

    var conn = httpTransport("http://192.168.5.2:9001/a/a.git", "nobody",
                             "5w8mfuzp6mlwc3p48inqs4thpq6ntbmk2ylc989w053rkgsf9r");
    var uploadpack = fetchpack(conn);
    var packChannel;

    // Create a repo by creating a plain object.
    var repo = {};

    // This provides an in-memory storage backend that provides the following APIs:
    // - saveAs(type, value) => hash
    // - loadAs(type, hash) => hash
    // - saveRaw(hash, binary) =>
    // - loadRaw(hash) => binary
    require('js-git/mixins/mem-db')(repo);

    // This provides extra methods for dealing with packfile streams.
    // It depends on
    // - unpack(packStream, opts) => hashes
    // - pack(hashes, opts) => packStream
    require('js-git/mixins/pack-ops')(repo);

    // This adds in walker algorithms for quickly walking history or a tree.
    // - logWalk(ref|hash) => stream<commit>
    // - treeWalk(hash) => stream<object>
    require('js-git/mixins/walkers')(repo);

    // This makes the object interface less strict.  See it's docs for details
    require('js-git/mixins/formats')(repo);

    // This adds a high-level API for creating multiple git objects by path.
    // - createTree(entries) => hash
    require('js-git/mixins/create-tree')(repo);

    // This provides symbolic names for the octal modes used by git trees.
    var modes = require('js-git/lib/modes');

    uploadpack.take(function(_, h) {
        for (k in h) {
            repo.updateRef(k, h[k], function(err, commit) {
                console.log("Add "+k+" "+commit);
            });
            uploadpack.put({want: h[k]});
        }
        uploadpack.put(null);
        uploadpack.put({done: true});
    });
    uploadpack.take(function(_, h) {
        packChannel = h.pack;
        repo.unpack(packChannel, {}, function(error, hashes) {
            console.log("got hashes "+hashes);
            for (k in repo.objects) {
                console.log("have object: " + k);
            }
            repo.readRef("refs/heads/master", function(err, commit) {
                repo.logWalk(commit, function(err, logStream) {
                    logStream.read(function(err, commit) {
                        repo.loadAs("tree", commit.tree, function(err, directory) {
                            repo.loadAs('text', directory['hello.txt'].hash, function(err, content) {
                                console.log(content);
                            });
                        });

                        var changes = [
                            {
                                path: "newfile.txt", // Create a new file in the existing directory.
                                mode: modes.file,
                                content: "my new file\n"
                            }
                        ];

                        // We need to use array form and specify the base tree hash as `base`.
                        changes.base = commit.tree;

                        repo.createTree(changes, function(_, treeHash) {
                            console.log("New tree hash " + treeHash);
                            newcommitobj = {
                                author: {
                                    name: "Peter",
                                    email: "pamstutz@veritasgenetics.com"
                                },
                                tree: treeHash,
                                message: "test commit",
                                parent: commit.hash
                            };
                            repo.saveAs("commit", newcommitobj, function(_, commithash) {
                                console.log("committed " + commithash);
                                doMoreStuff(conn, repo, newcommitobj, commithash);
                            });
                        });
                    });
                });
            });
        });
    });
});

function doMoreStuff(conn, repo, commitobj, commithash) {
    repo.updateRef("refs/heads/master", commithash, function(err, commit) {
        console.log("updated ref");
        var sendpack = require('js-git/net/git-send-pack')(conn);
        sendpack.take(function(_, h) {
            for (k in h) {
                console.log("Remote "+k+" "+h[k]);
            }
            sendpack.put({oldhash: commitobj.parent, newhash: commithash, ref: "refs/heads/master"});
            sendpack.put(null);

            var pushhashes = [commithash];
            repo.treeWalk(commitobj.tree, function(_, wk) {
                function collecthashes(_, item) {
                    if (item !== undefined) {
                        console.log("walked "+item.hash);
                        pushhashes.push(item.hash);
                        wk.read(collecthashes);
                    } else {
                        repo.pack(pushhashes, {}, function(error, enc) {
                            relay = function(_, item) {
                                if (item !== undefined) {
                                    sendpack.put(item);
                                    enc.take(relay);
                                } else {
                                    sendpack.put({flush: true});
                                }
                            };
                            enc.take(relay);
                        });
                    }
                }
                wk.read(collecthashes);
            });

            function prg(_, h) {
                if (h !== null && h.progress) {
                    console.log(h.progress);
                }
                sendpack.take(prg);
            };
            sendpack.take(prg);
        });
    });
}
