import { ISPRequest } from 'sp-request';

import { UrlHelper } from './UrlHelper';
import { ILogger } from './ILogger';
import { ConsoleLogger } from './ConsoleLogger';
import { defer, IDeferred } from './Defer';
import { reflect } from './promise-reflect';

export class FoldersCreator {

  private getFolderRestUrlBase: string;
  private createFolderRestUrlBase: string;
  private logger: ILogger;

  constructor(private sprequest: ISPRequest, private folder: string, private siteUrl: string) {
    this.folder = UrlHelper.trimSlashes(folder);
    this.siteUrl = UrlHelper.removeTrailingSlash(siteUrl);

    this.getFolderRestUrlBase = this.siteUrl + '/_api/web/GetFolderByServerRelativeUrl(@FolderName)';
    this.createFolderRestUrlBase = this.siteUrl + '/_api/web/folders';

    this.logger = new ConsoleLogger();
  }

  public createFoldersHierarchy(): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      const folderPaths: string[] = [];
      const paths: string[] = this.folder.split('/').filter(path => { return path !== ''; });

      this.createFoldersPathArray(paths, folderPaths);
      const getFolderPromises = [];
      folderPaths.forEach(folder => {
        const getFolderUrl: string = this.getFolderRestUrlBase + `?@FolderName='${encodeURIComponent(folder)}'`;
        getFolderPromises.push(this.sprequest.get(getFolderUrl));
      });

      Promise.all(getFolderPromises.map(reflect))
        .then(data => {
          const foldersToCreate: string[] = data.map((promise, index) => {
            /* sp onilne for some reason throws 500 when folder is not found :( */
            if (promise.isRejected && (promise.reason.response?.statusCode === 404 || promise.reason.response?.statusCode === 500)) {
              return index;
            } else if (promise.isRejected) {
              reject(promise.reason);
            }
          }).filter(index => {
            return index !== undefined;
          }).map(index => {
            return folderPaths[index];
          });

          if (foldersToCreate.length > 0) {
            this.logger.info(`Creating folder or full folders hierarchy: '${this.folder}'`);
            this.createFolders(foldersToCreate)
              .then(() => {
                resolve(undefined);
              })
              .catch(err => {
                reject(err);
              });
          } else {
            resolve(undefined);
          }
        });
    });

  }

  private createFolders(folders: string[], deferred?: IDeferred<any>): Promise<any> {
    if (!deferred) {
      deferred = defer<any>();
    }

    if (folders.length > 0) {
      this.sprequest.requestDigest(this.siteUrl)
        .then(digest => {
          return this.sprequest.post(this.createFolderRestUrlBase, {
            body: {
              '__metadata': { 'type': 'SP.Folder' },
              'ServerRelativeUrl': `${folders[0]}`
            },
            headers: {
              'X-RequestDigest': digest
            }
          });
        })
        .then(() => {
          this.createFolders(folders.slice(1, folders.length), deferred);

          return null;
        })
        .catch(err => {
          deferred.reject(err);
        });
    } else {
      deferred.resolve(undefined);
    }

    return deferred.promise;
  }

  private createFoldersPathArray(paths: string[], result: string[], index = 0): void {
    if (index === 0) {
      result.push(paths[index]);
    } else {
      result.push(`${result[index - 1]}/${paths[index]}`);
    }

    if (index === paths.length - 1) {
      return;
    }

    return this.createFoldersPathArray(paths, result, index + 1);
  }
}
