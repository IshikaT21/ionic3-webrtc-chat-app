import { Component } from '@angular/core';
import { NavController } from 'ionic-angular';
import { AndroidPermissions } from '@ionic-native/android-permissions';
import { XirsysV3Provider } from '../../providers/xirsys-v3/xirsys-v3';
import * as socketio from 'socket.io-client';

@Component({
  selector: 'page-home',
  templateUrl: 'home.html'
})
export class HomePage {

  sock: any;
	peerConnection: any;
  serverPeerConnection: any;
  sessionMenuClass: string = '';
  xExitButtonClass: string = '';
  SERVER_ADDRESS: string =  "https://741965ca.ngrok.io";
  username: string = "";
  messageDataChannel: any;
  serverSocketActions: any;
  activeUsers = [];
  remoteId: string;

  constructor(
		public navCtrl: NavController,
    private androidPermissions: AndroidPermissions,
    public xirsysV3: XirsysV3Provider
	){
    this.createPeerConnection();
    this.createMessageDataChannel();
    this.checkPermissions();
    this.connectToNodeServer();
    this.configureServerSocket();
    this.getCameraStream();
    this.getUsers();
  }

  connectToNodeServer(){
    this.sock = socketio(this.SERVER_ADDRESS);
  }

  checkPermissions(){
    this.androidPermissions.requestPermissions(
      [this.androidPermissions.PERMISSION.CAMERA,
        this.androidPermissions.PERMISSION.RECORD_AUDIO
      ]
    );

    this.androidPermissions.checkPermission(this.androidPermissions.PERMISSION.CAMERA).then(
      success => console.log("Hey you have permission"),
      err => {
        console.log("Uh oh, looks like you don't have permission");
        this.androidPermissions.requestPermission(this.androidPermissions.PERMISSION.CAMERA);
      }
    );

    this.androidPermissions.checkPermission(this.androidPermissions.PERMISSION.RECORD_AUDIO).then(
      success => console.log("Hey you have permission"),
      err => {
        console.log("Uh oh, looks like you don't have permission");
        this.androidPermissions.requestPermission(this.androidPermissions.PERMISSION.RECORD_AUDIO);
      }
    );
  }

  getCameraStream(){
    navigator.mediaDevices.getUserMedia({video: true, audio: false})
      .then(stream => {
        let video = document.getElementById('user-video-element');
        (<HTMLVideoElement>video).srcObject = stream;
        this.peerConnection.addStream(stream);
      })
      .catch(e => {
        console.log(e);
      });
  }

  displayNameChange(updatedDisplayName){
    this.serverSocketActions.updateDisplayName(updatedDisplayName);
  }

  displayNameSubstringer(displayName){
    if(displayName.length < 12){
      return displayName;
    }
    else{
      return displayName.substring(0,11) + "...";
    }
  }

  sessionMenuOpen(){
    this.sessionMenuClass = 'session-menu-open';
    this.xExitButtonClass = 'x-exit-button-active';
  }

  sessionMenuClose(){
    this.sessionMenuClass = 'session-menu-close';
    this.xExitButtonClass = 'x-exit-button-inactive';
  }

  createPeerConnection(){
    this.peerConnection = new webkitRTCPeerConnection({});
    this.peerConnection.onicecandidate = (event) => {
      if(event.candidate){
        let candidatePackage = {
          candidate: event.candidate,
          destinationClientId: this.remoteId
        }
        this.serverSocketActions.onIceCandidate(candidatePackage);
      }
      else{

      }
    };
    this.peerConnection.ondatachannel = (event) => {
      event.channel.onmessage = (ev) => {
        try{
          console.log(ev.data);
        }
        catch(e){
          console.log(e);
        }
      };
    };

    this.peerConnection.onaddstream = (event) => {
      let remoteVideoEl:any = document.getElementById('remote-video-element');
      remoteVideoEl.srcObject = event.stream;
    };

    this.peerConnection.oniceconnectionstatechange = (e) => {
      console.log("STATE CHANGE");
      console.log(this.peerConnection.iceConnectionState);
    }
  }

  createMessageDataChannel(){
    const messageDataChannelOptions = {
      ordered: true,
      maxRetransmitTime: 3000
    };
    let messagesDataChannel = this.peerConnection.createDataChannel("messages", messageDataChannelOptions);
    console.log("DATA CHANNEL CREATED");
    messagesDataChannel.onerror = (error) => {
      console.log(error);
    };
    messagesDataChannel.onmessage = (event) => {
      console.log(event.data);
    };
    messagesDataChannel.onopen = () => {
      messagesDataChannel.send("HEWO WULD");
    }
    messagesDataChannel.onclose = () => {
      console.log("CHANNEL CLOSED");
    }
  }

  handleAvailableClientClick(remoteUserId){
    this.sessionMenuClose();
    this.requestSession(remoteUserId);
  }

  requestSession(remoteUserId){
    this.serverSocketActions.requestSession(remoteUserId);
  }

  createOffer(destinationClientId){
    this.peerConnection.createOffer()
      .then( (offer) => {
        let initialOfferingPackage = {
          initialOffer: offer,
          destinationClientId: destinationClientId
        }
        this.peerConnection.setLocalDescription(offer);
        this.serverSocketActions.createInitialOffering(initialOfferingPackage);
      });
  }

  configureServerSocket(){

    this.serverSocketActions = {
      requestSession: (remoteUserId) => {
        this.sock.emit('request-session', remoteUserId);
      },
      updateDisplayName: (updatedDisplayName) => {
        this.sock.emit('updated-display-name', updatedDisplayName);
      },
      createInitialOffering: (initialOfferingPackage) => {
        this.sock.emit('initial-offering', initialOfferingPackage);
      },
      transmitAnswerPackage: (answerPackage) => {
        this.sock.emit('answer', answerPackage);
      },
      onIceCandidate: (candidatePackage) => {
        this.sock.emit('ice-candidate', candidatePackage);
      }
    };

    this.sock.on('display-names-updated', (activeUsers) => {
      let i = 0;
      for(let user in activeUsers.users){
        this.activeUsers[i] = activeUsers.users[user];
        i++;
      };
    });

    this.sock.on('session-confirmed', (remoteClientId) => {
      this.remoteId = remoteClientId;
      this.createOffer(remoteClientId);
    });

    this.sock.on('initial-offering-response', (response) => {
      const { initialOffer, senderClientId } = response;
      this.peerConnection.setRemoteDescription(initialOffer)
        .then(() => {
          this.peerConnection.createAnswer().then((answer) => {
            this.peerConnection.setLocalDescription(answer);
            const answerPackage = {
              answer: answer,
              destinationClientId: senderClientId
            }
            this.serverSocketActions.transmitAnswerPackage(answerPackage);
          })
        });
    });

    this.sock.on('answer-given', (response) => {
      const { answer } = response;
      this.peerConnection.setRemoteDescription(answer)
        .then(() => {
          console.log(this.peerConnection);
        });
    });

    this.sock.on('remote-sending-ice-candidate', (candidate) => {
      this.peerConnection.addIceCandidate(candidate);
    });

  }

  getUsers() {
  this.xirsysV3.getUsers()
  .then(data => {
    console.log(data);
    });
  }

}
