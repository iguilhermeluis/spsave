import { expect } from 'chai';
import * as sinon from 'sinon';
import * as mockery from 'mockery';
import { IUserCredentials } from 'sp-request';

import { FileSaver } from './../../src/core/FileSaver';
import { CheckinType, ICoreOptions, IFileContentOptions } from './../../src/core/SPSaveOptions';
import { defer, IDeferred } from './../../src/utils/Defer';

interface IFakeSPRequest {
  requestDigest?: sinon.SinonStub;
  post?: sinon.SinonStub;
  get?: sinon.SinonStub;
}

describe('spsave: FileSaver test', () => {

  const creds: IUserCredentials = {
    username: '',
    password: ''
  };

  const file: IFileContentOptions = {
    fileContent: 'spsave',
    folder: 'Assets',
    fileName: 'file.txt'
  };

  const core: ICoreOptions = {
    siteUrl: 'http://sp.url',
    checkinMessage: 'spsave',
    checkinType: CheckinType.minor
  };

  let fakeSPRequest: IFakeSPRequest = {};

  let foldersCreator: any;
  let foldersStub: sinon.SinonStub;
  let sprequest: any;
  let sprequestStub: sinon.SinonStub;
  let fileSaver: any;

  const fileServerRelativeUrl = `/${file.folder}/${file.fileName}`;

  const uploadFileRestUrl: string = core.siteUrl +
    '/_api/web/GetFolderByServerRelativeUrl(@FolderName)/Files/add(url=@FileName,overwrite=true)' +
    `?@FolderName='${encodeURIComponent(file.folder)}'&@FileName='${encodeURIComponent(file.fileName)}'`;

  const getFileRestUrl: string = core.siteUrl + '/_api/web/GetFileByServerRelativeUrl(@FileUrl)' +
    `?@FileUrl='${encodeURIComponent(fileServerRelativeUrl)}'`;

  const checkoutFileRestUrl: string = core.siteUrl + '/_api/web/GetFileByServerRelativeUrl(@FileUrl)/CheckOut()' +
    `?@FileUrl='${encodeURIComponent(fileServerRelativeUrl)}'`;

  const checkinFileRestUrl: string = core.siteUrl +
    '/_api/web/GetFileByServerRelativeUrl(@FileUrl)/CheckIn(comment=@Comment,checkintype=@Type)' +
    `?@FileUrl='${encodeURIComponent(fileServerRelativeUrl)}'&@Comment='${(core.checkinMessage)}'` +
    `&@Type='${core.checkinType}'`;
  const updateMetaDataFileUrl: string = core.siteUrl + '/_api/web/GetFileByServerRelativeUrl(@FileUrl)/ListItemAllFields' +
    `?@FileUrl='${encodeURIComponent(fileServerRelativeUrl)}'`;

  beforeEach(() => {
    mockery.enable({
      warnOnReplace: false,
      warnOnUnregistered: false,
      useCleanCache: true
    });

    core.checkin = false;

    fakeSPRequest = {
      post: sinon.stub(),
      get: sinon.stub(),
      requestDigest: sinon.stub().returns(Promise.resolve('digets'))
    };

    foldersCreator = require('./../../src/utils/FoldersCreator').FoldersCreator;
    sprequest = require('sp-request');
    sprequestStub = sinon.stub(sprequest, 'create').returns(fakeSPRequest);
    foldersStub = sinon.stub(foldersCreator.prototype, 'createFoldersHierarchy').returns(Promise.resolve({}));

    fileSaver = require('./../../src/core/FileSaver').FileSaver;
  });

  afterEach(() => {
    mockery.disable();
    foldersStub.restore();
    sprequestStub.restore();
  });

  it('should perform post request', done => {
    const consoleSpy: sinon.SinonStub = sinon.stub(console, 'log');
    const saver: FileSaver = new fileSaver(core, creds, file);
    fakeSPRequest.post.withArgs(uploadFileRestUrl).returns(Promise.resolve({ body: '{}' }));
    saver.save()
      .then(data => {
        consoleSpy.restore();
        expect(fakeSPRequest.post.called).is.true;
        done();
      })
      .catch(err => {
        consoleSpy.restore();
        done(err);
      });
  });

  it('should check if file is checked out and then upload', done => {
    const consoleSpy: sinon.SinonStub = sinon.stub(console, 'log');

    core.checkin = true;
    const saver: FileSaver = new fileSaver(core, creds, file);

    fakeSPRequest.post.withArgs(uploadFileRestUrl).returns(Promise.resolve({ body: '{}' }));
    fakeSPRequest.post.withArgs(checkinFileRestUrl).returns(Promise.resolve({ body: {} }));
    const getFileStub: sinon.SinonStub = fakeSPRequest.get.withArgs(getFileRestUrl).returns(Promise.resolve({
      body: {
        d: {
          CheckOutType: 0
        }
      }
    }));
    saver.save()
      .then(data => {
        consoleSpy.restore();
        expect(fakeSPRequest.post.called).is.true;
        expect(getFileStub.callCount).to.equal(1);
        done();
      })
      .catch(err => {
        consoleSpy.restore();
        done(err);
      });
  });

  it('should checkout file before upload', done => {
    const consoleSpy: sinon.SinonStub = sinon.stub(console, 'log');

    core.checkin = true;
    const saver: FileSaver = new fileSaver(core, creds, file);

    fakeSPRequest.post.withArgs(uploadFileRestUrl).returns(Promise.resolve({ body: '{}' }));
    fakeSPRequest.post.withArgs(checkoutFileRestUrl).returns(Promise.resolve({}));
    fakeSPRequest.post.withArgs(checkinFileRestUrl).returns(Promise.resolve({ body: {} }));
    fakeSPRequest.get.withArgs(getFileRestUrl).returns(Promise.resolve({
      body: {
        d: {
          CheckOutType: 1
        }
      }
    }));
    saver.save()
      .then(data => {
        consoleSpy.restore();
        expect(fakeSPRequest.post.callCount).to.equal(3);
        expect(fakeSPRequest.get.called).is.true;
        done();
      })
      .catch(err => {
        consoleSpy.restore();
        done(err);
      });
  });

  it('should try to reupload when save conflict', done => {
    const consoleSpy: sinon.SinonStub = sinon.stub(console, 'log');

    const saver: FileSaver = new fileSaver(core, creds, file);
    const errorString = '{"error": {"code" : "-2130246326"}}';
    const def: IDeferred<any> = defer();
    const error: Error = new Error();
    (<any>error).error = errorString;
    (<any>error).statusCode = 500;
    setTimeout(() => {
      def.reject(error);
    }, 100);

    fakeSPRequest.post.withArgs(uploadFileRestUrl).onCall(0).returns(def.promise);
    fakeSPRequest.post.withArgs(uploadFileRestUrl).onCall(1).returns(Promise.resolve({ body: '{}' }));

    saver.save()
      .then(data => {
        consoleSpy.restore();
        expect(fakeSPRequest.post.callCount).to.equal(2);
        done();
      })
      .catch(err => {
        consoleSpy.restore();
        done(err);
      });
  });

  it('should reject request if unable to create the folder', done => {
    const consoleSpy: sinon.SinonStub = sinon.stub(console, 'log');
    const saver: FileSaver = new fileSaver(core, creds, file);
    const folderDeferred: IDeferred<any> = defer();
    const folderCreateError: Error = new Error();
    setTimeout(() => {
      folderDeferred.reject(folderCreateError);
    }, 300);
    foldersStub.returns(folderDeferred.promise);

    const errorString = '{"error": {"code" : "-2147024893"}}';
    const def: IDeferred<any> = defer();
    const error: Error = new Error();
    error.message = errorString;
    (<any>error).error = errorString;
    (<any>error).statusCode = 404;
    setTimeout(() => {
      def.reject(error);
    }, 100);

    fakeSPRequest.post.withArgs(uploadFileRestUrl).onCall(0).returns(def.promise);

    saver.save()
      .then(data => {
        consoleSpy.restore();
        done(new Error('Deferred should be rejected'));
      })
      .catch(err => {
        consoleSpy.restore();
        expect(err).to.equal(folderCreateError);
        done();
      });
  });

  it('should create folder if folder does not exist', done => {
    const consoleSpy: sinon.SinonStub = sinon.stub(console, 'log');

    const saver: FileSaver = new fileSaver(core, creds, file);
    const errorString = '{"error": {"code" : "-2147024893"}}';
    const def: IDeferred<any> = defer();
    const error: Error = new Error();
    error.message = errorString;
    (<any>error).error = errorString;
    (<any>error).statusCode = 404;
    setTimeout(() => {
      def.reject(error);
    }, 100);

    fakeSPRequest.post.withArgs(uploadFileRestUrl).onCall(0).returns(def.promise);
    fakeSPRequest.post.withArgs(uploadFileRestUrl).onCall(1).returns(Promise.resolve({ body: '{}' }));

    saver.save()
      .then(data => {
        consoleSpy.restore();
        expect(fakeSPRequest.post.callCount).to.equal(2);
        done();
      })
      .catch(err => {
        consoleSpy.restore();
        done(err);
      });
  });

  it('should try to reupload when cobalt error', done => {
    const consoleSpy: sinon.SinonStub = sinon.stub(console, 'log');

    const saver: FileSaver = new fileSaver(core, creds, file);
    const errorString = '{"error": {"code" : "-1597308888"}}';
    const def: IDeferred<any> = defer();
    const error: Error = new Error();
    (<any>error).error = errorString;
    (<any>error).statusCode = 500;
    setTimeout(() => {
      def.reject(error);
    }, 100);
    fakeSPRequest.post.withArgs(uploadFileRestUrl).onCall(0).returns(def.promise);
    fakeSPRequest.post.withArgs(uploadFileRestUrl).onCall(1).returns(Promise.resolve({ body: '{}' }));

    saver.save()
      .then(data => {
        consoleSpy.restore();
        expect(fakeSPRequest.post.callCount).to.equal(2);
        done();
      })
      .catch(err => {
        consoleSpy.restore();
        done(err);
      });
  });

  it('should reject when undefined error string', done => {
    const consoleSpy: sinon.SinonStub = sinon.stub(console, 'log');

    const saver: FileSaver = new fileSaver(core, creds, file);
    const errorString = 'spsave';
    const def: IDeferred<any> = defer();
    const expectedError: Error = new Error();
    (<any>expectedError).error = errorString;
    (<any>expectedError).statusCode = 500;
    setTimeout(() => {
      def.reject(expectedError);
    }, 100);

    fakeSPRequest.post.withArgs(uploadFileRestUrl).onCall(0).returns(def.promise);
    fakeSPRequest.post.withArgs(uploadFileRestUrl).onCall(1).returns(Promise.resolve({ body: '{}' }));

    saver.save()
      .then(data => {
        consoleSpy.restore();
        done(new Error('Deferred should be rejected'));
      })
      .catch(err => {
        consoleSpy.restore();
        expect(err).to.equal(expectedError);
        done();
      });
  });

  it('should reject when undefined error', done => {
    const consoleSpy: sinon.SinonStub = sinon.stub(console, 'log');

    const saver: FileSaver = new fileSaver(core, creds, file);
    const def: IDeferred<any> = defer();
    const expectedError: Error = new Error();
    (<any>expectedError).statusCode = 500;
    setTimeout(() => {
      def.reject(expectedError);
    }, 100);

    fakeSPRequest.post.withArgs(uploadFileRestUrl).onCall(0).returns(def.promise);
    fakeSPRequest.post.withArgs(uploadFileRestUrl).onCall(1).returns(Promise.resolve({ body: '{}' }));

    saver.save()
      .then(data => {
        consoleSpy.restore();
        done(new Error('Deferred should be rejected'));
      })
      .catch(err => {
        consoleSpy.restore();
        expect(err).to.equal(expectedError);
        done();
      });
  });

  it('should reject when code 500 and undefined error object', done => {
    const consoleSpy: sinon.SinonStub = sinon.stub(console, 'log');

    const saver: FileSaver = new fileSaver(core, creds, file);
    const errorString = '{"info": {"code" : "-1597308888"}}';
    const def: IDeferred<any> = defer();
    const expectedError: Error = new Error();
    (<any>expectedError).error = errorString;
    (<any>expectedError).statusCode = 500;
    setTimeout(() => {
      def.reject(expectedError);
    }, 100);

    fakeSPRequest.post.withArgs(uploadFileRestUrl).onCall(0).returns(def.promise);
    fakeSPRequest.post.withArgs(uploadFileRestUrl).onCall(1).returns(Promise.resolve({ body: '{}' }));

    saver.save()
      .then(data => {
        consoleSpy.restore();
        done(new Error('Deferred should be rejected'));
      })
      .catch(err => {
        consoleSpy.restore();
        expect(err).to.equal(expectedError);
        done();
      });
  });

  it('should reject when code 500 and undefined error code', done => {
    const consoleSpy: sinon.SinonStub = sinon.stub(console, 'log');

    const saver: FileSaver = new fileSaver(core, creds, file);
    const errorString = '{"error": {"code" : "-1"}}';
    const def: IDeferred<any> = defer();
    const expectedError: Error = new Error();
    (<any>expectedError).error = errorString;
    (<any>expectedError).statusCode = 500;
    setTimeout(() => {
      def.reject(expectedError);
    }, 100);

    fakeSPRequest.post.withArgs(uploadFileRestUrl).onCall(0).returns(def.promise);
    fakeSPRequest.post.withArgs(uploadFileRestUrl).onCall(1).returns(Promise.resolve({ body: '{}' }));

    saver.save()
      .then(data => {
        consoleSpy.restore();
        done(new Error('Deferred should be rejected'));
      })
      .catch(err => {
        consoleSpy.restore();
        expect(err).to.equal(expectedError);
        done();
      });
  });

  it('should explicitly checkout the file', done => {
    const consoleSpy: sinon.SinonStub = sinon.stub(console, 'log');

    core.checkin = true;
    const saver: FileSaver = new fileSaver(core, creds, file);

    fakeSPRequest.post.withArgs(uploadFileRestUrl).returns(Promise.resolve({ body: '{}' }));
    fakeSPRequest.post.withArgs(checkoutFileRestUrl).returns(Promise.resolve({}));
    fakeSPRequest.post.withArgs(checkinFileRestUrl).returns(Promise.resolve({ body: {} }));
    const fileResultDeferred: IDeferred<any> = defer<any>();
    fileResultDeferred.reject(new Error('-2146232832'));

    fakeSPRequest.get.withArgs(getFileRestUrl).onCall(0).returns(fileResultDeferred.promise);
    fakeSPRequest.get.withArgs(getFileRestUrl).onCall(1).returns(Promise.resolve({
      body: {
        d: {
          CheckOutType: 0
        }
      }
    }));
    saver.save()
      .then(data => {
        consoleSpy.restore();
        expect(fakeSPRequest.post.callCount).to.equal(3);
        expect(fakeSPRequest.get.called).is.true;
        done();
      })
      .catch(err => {
        consoleSpy.restore();
        done(err);
      });
  });

  it('should explicitly reject in case of checkin error', done => {
    const consoleSpy: sinon.SinonStub = sinon.stub(console, 'log');

    core.checkin = true;
    const saver: FileSaver = new fileSaver(core, creds, file);

    fakeSPRequest.post.withArgs(uploadFileRestUrl).returns(Promise.resolve({ body: '{}' }));
    fakeSPRequest.post.withArgs(checkoutFileRestUrl).returns(Promise.resolve({}));
    const checkinDeferred: IDeferred<any> = defer<any>();
    setTimeout(() => {
      checkinDeferred.reject(new Error('spsave'));
    }, 100);

    fakeSPRequest.post.withArgs(checkinFileRestUrl).returns(checkinDeferred.promise);

    const getFileDeferred: IDeferred<any> = defer<any>();
    getFileDeferred.reject(new Error('-2146232832'));
    fakeSPRequest.get.withArgs(getFileRestUrl).onCall(0).returns(getFileDeferred.promise);

    fakeSPRequest.get.withArgs(getFileRestUrl).onCall(1).returns(Promise.resolve({
      body: {
        d: {
          CheckOutType: 0
        }
      }
    }));
    saver.save()
      .then(data => {
        consoleSpy.restore();
        done(new Error('Deferred should be rejected'));
      })
      .catch(err => {
        consoleSpy.restore();
        done();
      });

  });

  it('should reject when message other than "File not found"', done => {
    const consoleSpy: sinon.SinonStub = sinon.stub(console, 'log');

    core.checkin = true;
    const saver: FileSaver = new fileSaver(core, creds, file);

    fakeSPRequest.post.withArgs(uploadFileRestUrl).returns(Promise.resolve({ body: '{}' }));
    fakeSPRequest.post.withArgs(checkoutFileRestUrl).returns(Promise.resolve({}));
    fakeSPRequest.get.withArgs(getFileRestUrl).onCall(0).returns(Promise.reject(new Error('-1')));

    saver.save()
      .then(data => {
        consoleSpy.restore();
        done(new Error('Deferred should be rejected'));
      })
      .catch(err => {
        consoleSpy.restore();
        done();
      });
  });

  it('should reject when checkout failed', done => {
    const consoleSpy: sinon.SinonStub = sinon.stub(console, 'log');

    core.checkin = true;
    const saver: FileSaver = new fileSaver(core, creds, file);

    fakeSPRequest.post.withArgs(uploadFileRestUrl).returns(Promise.resolve({ body: '{}' }));
    fakeSPRequest.post.withArgs(checkoutFileRestUrl).returns(Promise.reject(new Error('spsave')));
    fakeSPRequest.get.withArgs(getFileRestUrl).returns(Promise.resolve({
      body: {
        d: {
          CheckOutType: 1
        }
      }
    }));

    saver.save()
      .then(data => {
        consoleSpy.restore();
        done(new Error('Deferred should be rejected'));
      })
      .catch(err => {
        consoleSpy.restore();
        done();
      });
  });

  it('should reject after max attempts', done => {
    const consoleSpy: sinon.SinonStub = sinon.stub(console, 'log');

    core.checkin = true;
    const saver: FileSaver = new fileSaver(core, creds, file);

    fakeSPRequest.post.withArgs(uploadFileRestUrl).returns(Promise.resolve({ body: '{}' }));
    fakeSPRequest.post.withArgs(checkoutFileRestUrl).returns(Promise.resolve({}));
    fakeSPRequest.post.withArgs(checkinFileRestUrl).returns(Promise.resolve({ body: {} }));
    fakeSPRequest.get.withArgs(getFileRestUrl).returns(Promise.reject(new Error('-2146232832')));

    saver.save()
      .then(data => {
        consoleSpy.restore();
        done(new Error('Deferred should be rejected'));
      })
      .catch(err => {
        consoleSpy.restore();
        done();
      });
  });

  it('should update file metadata', done => {
    const consoleSpy: sinon.SinonStub = sinon.stub(console, 'log');

    core.filesMetaData = [{
      fileName: file.fileName,
      metadata: {}
    }];

    const saver: FileSaver = new fileSaver(core, creds, file);

    const updateMetaDataStub: sinon.SinonStub = fakeSPRequest.post.withArgs(updateMetaDataFileUrl).returns(Promise.resolve({}));
    fakeSPRequest.post.withArgs(uploadFileRestUrl).returns(Promise.resolve({ body: '{}' }));

    saver.save()
      .then(data => {
        consoleSpy.restore();
        expect(updateMetaDataStub.callCount).to.equal(1);
        done();
      })
      .catch(err => {
        consoleSpy.restore();
        done(err);
      });
  });

  it('should not update file metadata when already updated', done => {
    const consoleSpy: sinon.SinonStub = sinon.stub(console, 'log');

    core.filesMetaData = [{
      fileName: file.fileName,
      metadata: {}
    }];

    const saver: FileSaver = new fileSaver(core, creds, file);

    const updateMetaDataStub: sinon.SinonStub = fakeSPRequest.post.withArgs(updateMetaDataFileUrl).returns(Promise.resolve({}));
    fakeSPRequest.post.withArgs(uploadFileRestUrl).returns(Promise.resolve({ body: '{}' }));

    saver.save()
      .then(data => {
        expect(updateMetaDataStub.callCount).to.equal(1);
        return saver.save();
      })
      .then(data => {
        consoleSpy.restore();
        expect(updateMetaDataStub.callCount).to.equal(1);
        done();
      })
      .catch(err => {
        consoleSpy.restore();
        done(err);
      });
  });

  it('should not upload file if string file content is empty', done => {
    const consoleSpy: sinon.SinonStub = sinon.stub(console, 'log');

    file.fileContent = '';

    const saver: FileSaver = new fileSaver(core, creds, file);

    const uploadStub: sinon.SinonStub = fakeSPRequest.post.withArgs(uploadFileRestUrl).returns(Promise.resolve({ body: '{}' }));

    saver.save()
      .then(data => {
        consoleSpy.restore();
        expect(uploadStub.callCount).to.equal(0);
        done();
      })
      .catch(err => {
        consoleSpy.restore();
        done(err);
      });
  });

  it('should not upload file if Buffer file content is empty', done => {
    const consoleSpy: sinon.SinonStub = sinon.stub(console, 'log');

    file.fileContent = new Buffer('');

    const saver: FileSaver = new fileSaver(core, creds, file);

    const uploadStub: sinon.SinonStub = fakeSPRequest.post.withArgs(uploadFileRestUrl).returns(Promise.resolve({ body: '{}' }));

    saver.save()
      .then(data => {
        consoleSpy.restore();
        expect(uploadStub.callCount).to.equal(0);
        done();
      })
      .catch(err => {
        consoleSpy.restore();
        done(err);
      });
  });
});
